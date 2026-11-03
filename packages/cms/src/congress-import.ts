import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  billLabel,
  bioguideUrl,
  CONGRESS_API_BASE,
  congressBillDetailSchema,
  congressBillPageSchema,
  congressCosponsorPageSchema,
  congressGovBillUrl,
  congressMemberPageSchema,
  congressYears,
  houseVoteMembersSchema,
  houseVotePageSchema,
  stateCode,
  type BillType,
  type CongressChamber,
  type CongressMember,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import {
  CONGRESS_ACCOUNT,
  ensureImportSource,
  fetchText,
  systemActor,
  todayUtc,
  withoutKey,
  type FetchOptions,
} from './ingest-common';

const {
  bill,
  billSponsorship,
  congressMembership,
  ingestRun,
  ingestSnapshot,
  personIdentifier,
  rollCallVote,
  votePosition,
} = schema;

/*
 * Congress.gov ingestion: members, bills with their sponsors and cosponsors, and House
 * roll-call votes for one Congress. Records are stored by Bioguide ID and reach a
 * CivicScope person through the crosswalk (see congress-crosswalk.ts). Everything is a
 * draft, keeps the source it came from, and is only rewritten when Congress.gov's own
 * "updated" stamp changes, so a second run on the same data changes nothing.
 */

export const CONGRESS_PARTS = ['members', 'bills', 'house-votes'] as const;
export type CongressPart = (typeof CONGRESS_PARTS)[number];

export interface CongressAttention {
  ref: string;
  name: string;
  problem: string;
}

interface Tally {
  listed: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Changed records left for the next run because a limit was reached. */
  deferred: number;
}
const tally = (): Tally => ({ listed: 0, created: 0, updated: 0, unchanged: 0, deferred: 0 });

export interface CongressRunSummary {
  congress: number;
  parts: CongressPart[];
  requests: number;
  /** Set when the run stopped at its request budget; the next run continues. */
  stoppedEarly: string | null;
  members: Tally;
  bills: Tally & { sponsorships: number };
  votes: Tally & { positions: number };
  /** Bioguide IDs in imported records that no CivicScope person has yet. */
  unmatched: { bioguideId: string; name: string; state: string | null }[];
  attention: CongressAttention[];
}

export interface CongressOptions extends FetchOptions {
  apiKey: string;
  baseUrl?: string;
  parts?: readonly CongressPart[];
  /** At most this many bills / votes are fetched in detail per run (the rest wait). */
  maxBills?: number;
  maxVotes?: number;
  /** Stop cleanly after this many API requests (DEMO_KEY allows very few). */
  maxRequests?: number;
  /** Pause between requests. Congress.gov allows 5,000 an hour per key. */
  minIntervalMs?: number;
  startedBy?: number | null;
  today?: string;
}

class RequestBudgetReached extends Error {}

/** Talks to the Congress.gov API: paces requests, validates and snapshots every response. */
class CongressClient {
  requests = 0;
  private last = 0;
  constructor(
    private db: Db,
    private runId: number,
    private opts: CongressOptions,
  ) {}

  async get<S extends z.ZodType>(
    path: string,
    params: Record<string, string | number>,
    schemaFor: S,
    what: string,
  ): Promise<z.infer<S>> {
    if (this.opts.maxRequests != null && this.requests >= this.opts.maxRequests) {
      throw new RequestBudgetReached(
        `Stopped after ${this.requests} requests (the limit for this run). The next run continues where this one stopped.`,
      );
    }
    const url = new URL(path, this.opts.baseUrl ?? CONGRESS_API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set('format', 'json');
    url.searchParams.set('api_key', this.opts.apiKey);
    const wait = (this.opts.minIntervalMs ?? 750) - (Date.now() - this.last);
    if (wait > 0 && this.requests > 0) {
      await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    }
    this.requests++;
    this.last = Date.now();
    const body = await fetchText(url, this.opts);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`${what} from Congress.gov is not JSON.`);
    }
    const parsed = schemaFor.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${what} from Congress.gov is not in the expected format (${issue?.path.join('.')}: ${issue?.message}). Nothing more was imported.`,
      );
    }
    await this.db.insert(ingestSnapshot).values({ runId: this.runId, url: withoutKey(url), body });
    return parsed.data;
  }

  /** Every page of a list endpoint (Congress.gov pages with offset and limit). */
  async *pages<S extends z.ZodType>(
    path: string,
    params: Record<string, string | number>,
    schemaFor: S,
    what: string,
  ): AsyncGenerator<z.infer<S>> {
    const limit = 250;
    for (let offset = 0, page = 1; ; offset += limit, page++) {
      const data = await this.get(
        path,
        { ...params, limit, offset },
        schemaFor,
        `${what}, page ${page}`,
      );
      yield data;
      const { pagination } = data as { pagination: { count: number; next?: string | null } };
      if (!pagination.next || offset + limit >= pagination.count) return;
      if (page >= 400) throw new Error(`${what}: stopped after 400 pages; more than expected.`);
    }
  }
}

/** Compares the stored row with the new values, ignoring bookkeeping columns. */
function differs(row: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return Object.entries(values).some(([k, v]) => {
    const a = row[k] instanceof Date ? (row[k] as Date).toISOString() : (row[k] ?? null);
    const b = v instanceof Date ? v.toISOString() : (v ?? null);
    return a !== b;
  });
}

async function upsert<T extends typeof congressMembership | typeof bill | typeof rollCallVote>(
  tx: Tx,
  actor: Actor,
  table: T,
  entityType: string,
  existing: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
  note: string,
): Promise<{ id: number; action: 'created' | 'updated' | 'unchanged' }> {
  // Only the data columns are written: publish state and anything else an editor
  // controls is never touched by an update. All three tables share the columns used
  // here (id), so one of them stands in for the type.
  const t = table as unknown as typeof bill;
  const data = values as typeof bill.$inferInsert;
  const load = async (id: number) =>
    (await tx.select().from(t).where(eq(t.id, id)))[0] as Record<string, unknown>;
  if (existing) {
    const id = existing.id as number;
    if (!differs(existing, values)) return { id, action: 'unchanged' };
    await tx.update(t).set(data).where(eq(t.id, id));
    await recordChange(tx, actor, {
      entityType,
      entityId: id,
      action: 'update',
      before: existing,
      after: await load(id),
      note,
    });
    return { id, action: 'updated' };
  }
  const [res] = await tx.insert(t).values(data);
  const id = res.insertId;
  await recordChange(tx, actor, {
    entityType,
    entityId: id,
    action: 'create',
    before: null,
    after: await load(id),
    note,
  });
  return { id, action: 'created' };
}

/** The terms of a member's service that fall in one Congress, one per chamber. */
export function termsInCongress(
  m: CongressMember,
  congress: number,
): { chamber: CongressChamber; startYear: number; endYear: number | null }[] {
  const [y1, y2] = congressYears(congress);
  const overlapping = m.terms.item.filter(
    (t) => t.startYear <= y2 && (t.endYear == null || t.endYear >= y1),
  );
  // A term "ending" in the Congress's first year usually ended on January 3, in the
  // Congress before. Keep it only when nothing else overlaps (a member who left early).
  const strict = overlapping.filter(
    (t) => t.endYear == null || t.endYear > y1 || t.startYear >= y1,
  );
  const chosen = strict.length ? strict : overlapping;
  const byChamber = new Map<CongressChamber, (typeof chosen)[number]>();
  for (const t of chosen) {
    const chamber = t.chamber === 'Senate' ? 'senate' : 'house';
    const prev = byChamber.get(chamber);
    if (!prev || t.startYear > prev.startYear) byChamber.set(chamber, t);
  }
  return [...byChamber.entries()].map(([chamber, t]) => ({
    chamber,
    startYear: t.startYear,
    endYear: t.endYear ?? null,
  }));
}

/**
 * Imports one Congress from Congress.gov. Run the crosswalk first so the records find
 * their people; anything that doesn't is listed and attaches on its own once the
 * person gets the Bioguide ID.
 */
export async function runCongressImport(
  db: Db,
  congress: number,
  opts: CongressOptions,
): Promise<{ runId: number; summary: CongressRunSummary }> {
  const parts = [...(opts.parts ?? CONGRESS_PARTS)];
  const today = opts.today ?? todayUtc();
  const actor = await systemActor(db, CONGRESS_ACCOUNT);
  const [run] = await db.insert(ingestRun).values({
    source: 'congress_gov',
    params: { congress, parts, maxBills: opts.maxBills ?? null, maxVotes: opts.maxVotes ?? null },
    startedBy: opts.startedBy ?? null,
  });
  const runId = run.insertId;
  const api = new CongressClient(db, runId, opts);
  const summary: CongressRunSummary = {
    congress,
    parts,
    requests: 0,
    stoppedEarly: null,
    members: tally(),
    bills: { ...tally(), sponsorships: 0 },
    votes: { ...tally(), positions: 0 },
    unmatched: [],
    attention: [],
  };
  /** Bioguide IDs seen in this run, with a name and state to show if unmatched. */
  const seen = new Map<string, { name: string; state: string | null }>();
  const see = (id: string, name: string | null | undefined, state: string | null | undefined) => {
    if (!seen.has(id)) seen.set(id, { name: name?.trim() || id, state: state ?? null });
  };

  try {
    if (parts.includes('members')) await importMembers();
    if (parts.includes('bills')) await importBills();
    if (parts.includes('house-votes')) await importHouseVotes();
  } catch (error) {
    if (error instanceof RequestBudgetReached) {
      summary.stoppedEarly = error.message;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      summary.requests = api.requests;
      await db
        .update(ingestRun)
        .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
        .where(eq(ingestRun.id, runId));
      throw error;
    }
  }

  summary.requests = api.requests;
  if (seen.size) {
    const known = new Set(
      (
        await db
          .select({ value: personIdentifier.value })
          .from(personIdentifier)
          .where(
            and(
              eq(personIdentifier.scheme, 'bioguide'),
              inArray(personIdentifier.value, [...seen.keys()]),
            ),
          )
      ).map((r) => r.value),
    );
    summary.unmatched = [...seen.entries()]
      .filter(([id]) => !known.has(id))
      .map(([bioguideId, v]) => ({ bioguideId, ...v }))
      .sort((a, b) => a.bioguideId.localeCompare(b.bioguideId));
  }
  await db
    .update(ingestRun)
    .set({ state: 'succeeded', finishedAt: new Date(), summary })
    .where(eq(ingestRun.id, runId));
  return { runId, summary };

  // -------------------------------------------------------------------------------

  async function importMembers() {
    const existing = new Map(
      (
        await db.select().from(congressMembership).where(eq(congressMembership.congress, congress))
      ).map((r) => [`${r.bioguideId}:${r.chamber}`, r] as const),
    );
    for await (const page of api.pages(
      `/v3/member/congress/${congress}`,
      { currentMember: 'false' },
      congressMemberPageSchema,
      `Members of the ${congress}th Congress`,
    )) {
      for (const m of page.members) {
        summary.members.listed++;
        const state = stateCode(m.state);
        see(m.bioguideId, m.name, state);
        if (!state) {
          summary.attention.push({
            ref: m.bioguideId,
            name: m.name,
            problem: `Congress.gov lists the state as “${m.state}”, which CivicScope doesn’t recognize. Not imported.`,
          });
          continue;
        }
        const terms = termsInCongress(m, congress);
        if (!terms.length) {
          summary.attention.push({
            ref: m.bioguideId,
            name: m.name,
            problem: `Listed for the ${congress}th Congress, but none of the terms Congress.gov gives fall in it. Not imported.`,
          });
          continue;
        }
        for (const t of terms) {
          const before = existing.get(`${m.bioguideId}:${t.chamber}`);
          if (before && before.sourceUpdatedAt === (m.updateDate ?? '')) {
            summary.members.unchanged++;
            continue;
          }
          const result = await db.transaction(async (tx) => {
            const sourceId = await ensureImportSource(
              tx,
              actor,
              {
                url: bioguideUrl(m.bioguideId),
                title: `${m.name}, Biographical Directory of the United States Congress`,
                publisher: 'U.S. Congress',
                sourceType: 'government_record',
              },
              today,
            );
            return upsert(
              tx,
              actor,
              congressMembership,
              'congress_membership',
              before,
              {
                bioguideId: m.bioguideId,
                congress,
                chamber: t.chamber,
                state,
                district: t.chamber === 'house' ? (m.district ?? 0) : null,
                partyName: m.partyName ?? null,
                startYear: t.startYear,
                endYear: t.endYear,
                sourceId,
                sourceUpdatedAt: m.updateDate ?? '',
              },
              'From the Congress.gov member list',
            );
          });
          summary.members[result.action]++;
        }
      }
    }
  }

  async function importBills() {
    const existing = new Map(
      (await db.select().from(bill).where(eq(bill.congress, congress))).map(
        (r) => [`${r.billType}:${r.number}`, r] as const,
      ),
    );
    let detailed = 0;
    // Oldest change first. The space is sent as "+", which is what Congress.gov expects;
    // a literal "+" would be sent as %2B, and the API then ignores the sort.
    for await (const page of api.pages(
      `/v3/bill/${congress}`,
      { sort: 'updateDate asc' },
      congressBillPageSchema,
      `Bills of the ${congress}th Congress`,
    )) {
      for (const b of page.bills) {
        summary.bills.listed++;
        const number = Number(b.number);
        const before = existing.get(`${b.type}:${number}`);
        if (before && before.sourceUpdatedAt === b.updateDate) {
          summary.bills.unchanged++;
          continue;
        }
        if (opts.maxBills != null && detailed >= opts.maxBills) {
          summary.bills.deferred++;
          continue;
        }
        detailed++;
        await importBill(b.type, number, before);
      }
    }
  }

  async function importBill(type: BillType, number: number, before?: typeof bill.$inferSelect) {
    const label = billLabel(type, number);
    const { bill: d } = await api.get(
      `/v3/bill/${congress}/${type}/${number}`,
      {},
      congressBillDetailSchema,
      label,
    );
    const cosponsors: z.infer<typeof congressCosponsorPageSchema>['cosponsors'] = [];
    if ((d.cosponsors?.count ?? 0) > 0) {
      for await (const page of api.pages(
        `/v3/bill/${congress}/${type}/${number}/cosponsors`,
        {},
        congressCosponsorPageSchema,
        `${label} cosponsors`,
      )) {
        cosponsors.push(...page.cosponsors);
      }
    }
    const rows = new Map<string, typeof billSponsorship.$inferInsert>();
    for (const s of d.sponsors ?? []) {
      see(s.bioguideId, s.fullName, s.state);
      rows.set(s.bioguideId, {
        billId: 0,
        bioguideId: s.bioguideId,
        role: 'sponsor',
        isOriginal: false,
        sponsoredOn: d.introducedDate ?? null,
        withdrawnOn: null,
        party: s.party ?? null,
        state: s.state ?? null,
      });
    }
    for (const c of cosponsors) {
      see(c.bioguideId, c.fullName, c.state);
      if (rows.has(c.bioguideId)) continue;
      rows.set(c.bioguideId, {
        billId: 0,
        bioguideId: c.bioguideId,
        role: 'cosponsor',
        isOriginal: c.isOriginalCosponsor ?? false,
        sponsoredOn: c.sponsorshipDate ?? null,
        withdrawnOn: c.sponsorshipWithdrawnDate ?? null,
        party: c.party ?? null,
        state: c.state ?? null,
      });
    }

    const result = await db.transaction(async (tx) => {
      const sourceId = await ensureImportSource(
        tx,
        actor,
        {
          url: congressGovBillUrl(congress, type, number),
          title: `${label}, ${congress}th Congress: ${d.title}`,
          publisher: 'Library of Congress (Congress.gov)',
          sourceType: 'legislative_record',
        },
        today,
      );
      const r = await upsert(
        tx,
        actor,
        bill,
        'bill',
        before,
        {
          congress,
          billType: type,
          number,
          title: d.title.slice(0, 2000),
          introducedOn: d.introducedDate ?? null,
          policyArea: d.policyArea?.name ?? null,
          latestActionOn: d.latestAction?.actionDate ?? null,
          latestActionText: d.latestAction?.text?.slice(0, 2000) ?? null,
          sourceId,
          sourceUpdatedAt: d.updateDate,
        },
        'From Congress.gov',
      );
      summary.bills.sponsorships += await syncSponsorships(tx, r.id, [...rows.values()]);
      return r;
    });
    summary.bills[result.action === 'unchanged' ? 'updated' : result.action]++;
  }

  /** Makes the stored sponsors match the source; returns how many rows changed. */
  async function syncSponsorships(
    tx: Tx,
    billId: number,
    rows: (typeof billSponsorship.$inferInsert)[],
  ): Promise<number> {
    const current = new Map(
      (await tx.select().from(billSponsorship).where(eq(billSponsorship.billId, billId))).map(
        (r) => [r.bioguideId, r] as const,
      ),
    );
    let changed = 0;
    for (const row of rows) {
      const values = { ...row, billId };
      const had = current.get(row.bioguideId);
      current.delete(row.bioguideId);
      if (!had) {
        await tx.insert(billSponsorship).values(values);
        changed++;
      } else if (differs(had, values)) {
        await tx.update(billSponsorship).set(values).where(eq(billSponsorship.id, had.id));
        changed++;
      }
    }
    // Rows the source no longer lists. (Withdrawn cosponsors stay listed, with a date.)
    for (const gone of current.values()) {
      await tx.delete(billSponsorship).where(eq(billSponsorship.id, gone.id));
      changed++;
    }
    return changed;
  }

  async function importHouseVotes() {
    const existing = new Map(
      (
        await db
          .select()
          .from(rollCallVote)
          .where(and(eq(rollCallVote.chamber, 'house'), eq(rollCallVote.congress, congress)))
      ).map((r) => [`${r.session}:${r.rollNumber}`, r] as const),
    );
    const [first] = congressYears(congress);
    const thisYear = Number(today.slice(0, 4));
    let detailed = 0;
    for (const session of [1, 2]) {
      if (first + session - 1 > thisYear) break;
      for await (const page of api.pages(
        `/v3/house-vote/${congress}/${session}`,
        {},
        houseVotePageSchema,
        `House votes, ${congress}th Congress, session ${session}`,
      )) {
        for (const v of page.houseRollCallVotes) {
          summary.votes.listed++;
          const before = existing.get(`${session}:${v.rollCallNumber}`);
          if (before && before.sourceUpdatedAt === v.updateDate) {
            summary.votes.unchanged++;
            continue;
          }
          if (opts.maxVotes != null && detailed >= opts.maxVotes) {
            summary.votes.deferred++;
            continue;
          }
          detailed++;
          await importHouseVote(session, v.rollCallNumber, before);
        }
      }
    }
  }

  async function importHouseVote(
    session: number,
    roll: number,
    before?: typeof rollCallVote.$inferSelect,
  ) {
    const { houseRollCallVoteMemberVotes: v } = await api.get(
      `/v3/house-vote/${congress}/${session}/${roll}/members`,
      {},
      houseVoteMembersSchema,
      `House roll call ${roll} (session ${session})`,
    );
    if (v.rollCallNumber !== roll || v.sessionNumber !== session || v.congress !== congress) {
      throw new Error(
        `Asked Congress.gov for House roll call ${roll} (session ${session}) and got roll call ${v.rollCallNumber} (session ${v.sessionNumber}, ${v.congress}th Congress).`,
      );
    }
    const votedAt = new Date(v.startDate);
    const year = votedAt.getUTCFullYear();
    const positions = new Map<string, typeof votePosition.$inferInsert>();
    for (const p of v.results) {
      see(p.bioguideID, [p.firstName, p.lastName].filter(Boolean).join(' '), p.voteState);
      if (positions.has(p.bioguideID)) {
        summary.attention.push({
          ref: `House roll call ${roll}, ${year}`,
          name: p.bioguideID,
          problem: 'This member is listed twice in the vote; the first entry was kept.',
        });
        continue;
      }
      positions.set(p.bioguideID, {
        voteId: 0,
        bioguideId: p.bioguideID,
        voteCast: p.voteCast,
        party: p.voteParty ?? null,
        state: p.voteState ?? null,
      });
    }
    const result = await db.transaction(async (tx) => {
      const sourceId = await ensureImportSource(
        tx,
        actor,
        {
          url: v.sourceDataURL ?? `https://clerk.house.gov/Votes/${year}${roll}`,
          title: `House roll call ${roll}, ${year}${v.voteQuestion ? `: ${v.voteQuestion}` : ''}`,
          publisher: 'Office of the Clerk, U.S. House of Representatives',
          sourceType: 'legislative_record',
        },
        today,
      );
      const r = await upsert(
        tx,
        actor,
        rollCallVote,
        'roll_call_vote',
        before,
        {
          chamber: 'house',
          congress,
          session,
          rollNumber: roll,
          votedAt,
          question: v.voteQuestion?.slice(0, 500) ?? null,
          voteType: v.voteType?.slice(0, 100) ?? null,
          result: v.result?.slice(0, 100) ?? null,
          legislationType: v.legislationType?.slice(0, 20) || null,
          legislationNumber: v.legislationNumber?.slice(0, 20) || null,
          sourceId,
          sourceUpdatedAt: v.updateDate,
        },
        `From Congress.gov; ${positions.size} members recorded`,
      );
      // The positions are replaced as a set: they only ever come from this one record.
      await tx.delete(votePosition).where(eq(votePosition.voteId, r.id));
      const rows = [...positions.values()].map((p) => ({ ...p, voteId: r.id }));
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(votePosition).values(rows.slice(i, i + 500));
      }
      return r;
    });
    summary.votes.positions += positions.size;
    summary.votes[result.action === 'unchanged' ? 'updated' : result.action]++;
  }
}

// ---------------------------------------------------------------------------------
// Reading

/** A person's congressional record, through their Bioguide ID(s). */
export async function getCongressRecord(db: Db, personId: number, limit = 20) {
  const ids = (
    await db
      .select({ value: personIdentifier.value, scheme: personIdentifier.scheme })
      .from(personIdentifier)
      .where(eq(personIdentifier.personId, personId))
  )
    .filter((r) => r.scheme === 'bioguide')
    .map((r) => r.value);
  if (!ids.length) return null;
  const memberships = await db
    .select()
    .from(congressMembership)
    .where(inArray(congressMembership.bioguideId, ids))
    .orderBy(desc(congressMembership.congress));
  const [sponsored] = await db
    .select({
      sponsor: sql<number>`sum(${billSponsorship.role} = 'sponsor')`,
      cosponsor: sql<number>`sum(${billSponsorship.role} = 'cosponsor')`,
    })
    .from(billSponsorship)
    .where(inArray(billSponsorship.bioguideId, ids));
  const bills = await db
    .select({
      id: bill.id,
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      role: billSponsorship.role,
      sponsoredOn: billSponsorship.sponsoredOn,
      withdrawnOn: billSponsorship.withdrawnOn,
    })
    .from(billSponsorship)
    .innerJoin(bill, eq(bill.id, billSponsorship.billId))
    .where(inArray(billSponsorship.bioguideId, ids))
    .orderBy(desc(billSponsorship.sponsoredOn), desc(bill.id))
    .limit(limit);
  const [voteCount] = await db
    .select({ n: count() })
    .from(votePosition)
    .where(inArray(votePosition.bioguideId, ids));
  const votes = await db
    .select({
      id: rollCallVote.id,
      chamber: rollCallVote.chamber,
      congress: rollCallVote.congress,
      session: rollCallVote.session,
      rollNumber: rollCallVote.rollNumber,
      votedAt: rollCallVote.votedAt,
      question: rollCallVote.question,
      result: rollCallVote.result,
      legislationType: rollCallVote.legislationType,
      legislationNumber: rollCallVote.legislationNumber,
      voteCast: votePosition.voteCast,
      party: votePosition.party,
      state: votePosition.state,
    })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .where(inArray(votePosition.bioguideId, ids))
    .orderBy(desc(rollCallVote.votedAt))
    .limit(limit);
  return {
    bioguideIds: ids,
    memberships,
    sponsorCount: Number(sponsored?.sponsor ?? 0),
    cosponsorCount: Number(sponsored?.cosponsor ?? 0),
    bills,
    voteCount: voteCount?.n ?? 0,
    votes,
  };
}
