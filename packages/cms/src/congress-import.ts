import { and, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import type { z } from 'zod';
import {
  billLabel,
  billStage,
  bioguideUrl,
  CONGRESS_API_BASE,
  congressBillDetailSchema,
  congressBillPageSchema,
  congressBillSummariesSchema,
  congressBillTextSchema,
  congressCosponsorPageSchema,
  congressGovBillUrl,
  congressMemberPageSchema,
  congressYears,
  houseVoteMembersSchema,
  houseVotePageSchema,
  htmlToPlainText,
  legislatorFileSchema,
  LEGISLATORS_BASE,
  parseSenateDateTime,
  parseSenateXml,
  SENATE_BASE,
  senateVoteMeasure,
  senateVoteMenuSchema,
  senateVoteMenuUrl,
  senateVotePageUrl,
  senateVoteSchema,
  senateVoteXmlUrl,
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
  source,
  votePosition,
} = schema;

/*
 * Congress.gov ingestion: members, bills with their sponsors and cosponsors, and House
 * roll-call votes for one Congress. Senate roll-call votes come from senate.gov's own
 * XML files (Congress.gov has none) and are matched to members by their LIS ID, which
 * congress-legislators lists next to the Bioguide ID. Records are stored by Bioguide ID and reach a
 * CivicScope person through the crosswalk (see congress-crosswalk.ts). Everything is a
 * draft, keeps the source it came from, and is only rewritten when Congress.gov's own
 * "updated" stamp changes, so a second run on the same data changes nothing.
 */

export const CONGRESS_PARTS = ['members', 'bills', 'house-votes', 'senate-votes'] as const;
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
  /** Senate votes. Older summaries don't have it. */
  senateVotes?: Tally & { positions: number };
  /** Bioguide IDs in imported records that no CivicScope person has yet. */
  unmatched: { bioguideId: string; name: string; state: string | null }[];
  attention: CongressAttention[];
}

export interface CongressOptions extends FetchOptions {
  /** Needed for every part except Senate votes. */
  apiKey: string;
  baseUrl?: string;
  senateBaseUrl?: string;
  legislatorsBaseUrl?: string;
  /**
   * Fetch Senate votes that are already stored again, to pick up corrections. The
   * Senate's vote list has no "last changed" date, so a normal run fetches only votes it
   * doesn't have (and votes it couldn't fully attach last time).
   */
  refreshSenateVotes?: boolean;
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

  /**
   * A file from another source (senate.gov, congress-legislators): same pacing, budget
   * and snapshot, no API key. Returns the body.
   */
  async getRaw(url: URL, accept: string): Promise<string> {
    if (this.opts.maxRequests != null && this.requests >= this.opts.maxRequests) {
      throw new RequestBudgetReached(
        `Stopped after ${this.requests} requests (the limit for this run). The next run continues where this one stopped.`,
      );
    }
    const wait = (this.opts.minIntervalMs ?? 750) - (Date.now() - this.last);
    if (wait > 0 && this.requests > 0) {
      await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    }
    this.requests++;
    this.last = Date.now();
    const body = await fetchText(url, this.opts, accept);
    await this.db.insert(ingestSnapshot).values({ runId: this.runId, url: url.toString(), body });
    return body;
  }

  /** A senate.gov XML file, parsed and validated. */
  async getSenateXml<S extends z.ZodType>(
    url: string,
    schemaFor: S,
    what: string,
  ): Promise<z.infer<S>> {
    const body = await this.getRaw(new URL(url), 'application/xml, text/xml');
    let xml: unknown;
    try {
      xml = parseSenateXml(body);
    } catch {
      throw new Error(`${what} from senate.gov is not XML.`);
    }
    const parsed = schemaFor.safeParse(xml);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${what} from senate.gov is not in the expected format (${issue?.path.join('.')}: ${issue?.message}). Nothing more was imported.`,
      );
    }
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

/**
 * Whether a stored bill already reflects the bill list's `updateDate`. The list gives
 * only a date ("2025-01-14") while the detail gives a timestamp
 * ("2025-01-14T09:05:19Z"), so equal strings almost never happen. The stored record is
 * current when its own stamp is on or after that date and it was fetched after that
 * date ended everywhere in the U.S. (noon UTC the next day); a bill changed again later
 * the same day it was fetched is fetched once more.
 */
export function billUpToDate(
  stored: { sourceUpdatedAt: string; sourceCheckedAt: Date | null },
  listed: string,
): boolean {
  if (stored.sourceUpdatedAt === listed) return true;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(listed) ? Date.parse(`${listed}T00:00:00Z`) : NaN;
  const storedAt = Date.parse(stored.sourceUpdatedAt);
  if (Number.isNaN(day) || Number.isNaN(storedAt) || !stored.sourceCheckedAt) return false;
  const storedDay = new Date(storedAt).toISOString().slice(0, 10);
  return storedDay >= listed && stored.sourceCheckedAt.getTime() >= day + 36 * 3600 * 1000;
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
    senateVotes: { ...tally(), positions: 0 },
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
    if (parts.includes('senate-votes')) await importSenateVotes();
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
          if (
            before &&
            before.sourceUpdatedAt === (m.updateDate ?? '') &&
            before.memberName === m.name.slice(0, 200)
          ) {
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
                memberName: m.name.slice(0, 200),
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
    await backfillStages();
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
        // Bills stored before summaries and text were read are read once more.
        if (before && before.extrasCheckedAt && billUpToDate(before, b.updateDate)) {
          summary.bills.unchanged++;
          continue;
        }
        if (opts.maxBills != null && detailed >= opts.maxBills) {
          summary.bills.deferred++;
          continue;
        }
        detailed++;
        // Keep the map current: a bill that changes during a long run moves to the end
        // of the list and comes round again, and must then be updated, not re-inserted.
        const id = await importBill(b.type, number, before);
        const [row] = await db.select().from(bill).where(eq(bill.id, id));
        existing.set(`${b.type}:${number}`, row!);
      }
    }
  }

  /**
   * Gives bills stored before stages existed their stage, from the latest action already
   * stored. Derived, like the stage itself, so it is not recorded as an edit.
   */
  async function backfillStages() {
    const rows = await db
      .select({ id: bill.id, billType: bill.billType, latestActionText: bill.latestActionText })
      .from(bill)
      .where(and(eq(bill.congress, congress), isNull(bill.stage)));
    for (const r of rows) {
      await db
        .update(bill)
        .set({
          stage: billStage(r.billType, r.latestActionText),
          updatedAt: sql`${bill.updatedAt}`,
        })
        .where(eq(bill.id, r.id));
    }
  }

  async function importBill(type: BillType, number: number, before?: typeof bill.$inferSelect) {
    const label = billLabel(type, number);
    const checkedAt = new Date();
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
    let crs: { text: string; version: string | null; date: string | null } | null = null;
    if ((d.summaries?.count ?? 0) > 0) {
      const { summaries } = await api.get(
        `/v3/bill/${congress}/${type}/${number}/summaries`,
        {},
        congressBillSummariesSchema,
        `${label} summaries`,
      );
      // The summary of the latest version of the bill.
      const latest = [...summaries].sort((a, b) =>
        `${a.actionDate ?? ''}${a.updateDate ?? ''}`.localeCompare(
          `${b.actionDate ?? ''}${b.updateDate ?? ''}`,
        ),
      )[summaries.length - 1];
      const text = latest ? htmlToPlainText(latest.text) : null;
      if (latest && text) {
        crs = {
          text: text.slice(0, 60_000),
          version: latest.actionDesc?.slice(0, 200) ?? null,
          date: latest.actionDate ?? null,
        };
      }
    }
    let printed: { url: string; version: string | null; date: string | null } | null = null;
    if ((d.textVersions?.count ?? 0) > 0) {
      const { textVersions } = await api.get(
        `/v3/bill/${congress}/${type}/${number}/text`,
        {},
        congressBillTextSchema,
        `${label} text`,
      );
      const latest = [...textVersions]
        .filter((v) => v.formats.length > 0)
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
        .at(-1);
      const format =
        latest?.formats.find((f) => f.type === 'Formatted Text') ??
        latest?.formats.find((f) => f.type === 'PDF') ??
        latest?.formats[0];
      if (latest && format && format.url.length <= 1000) {
        printed = {
          url: format.url,
          version: latest.type?.slice(0, 200) ?? null,
          date:
            latest.date && /^\d{4}-\d{2}-\d{2}/.test(latest.date) ? latest.date.slice(0, 10) : null,
        };
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
          stage: billStage(type, d.latestAction?.text, { becameLaw: (d.laws?.length ?? 0) > 0 }),
          summary: crs?.text ?? null,
          summaryVersion: crs?.version ?? null,
          summaryDate: crs?.date ?? null,
          textUrl: printed?.url ?? null,
          textVersion: printed?.version ?? null,
          textDate: printed?.date ?? null,
          sourceId,
          sourceUpdatedAt: d.updateDate,
        },
        'From Congress.gov',
      );
      const sponsorships = await syncSponsorships(tx, r.id, [...rows.values()]);
      summary.bills.sponsorships += sponsorships;
      // Bookkeeping only: keep updated_at as the time the bill's data last changed.
      await tx
        .update(bill)
        .set({
          sourceCheckedAt: checkedAt,
          extrasCheckedAt: checkedAt,
          updatedAt: sql`${bill.updatedAt}`,
        })
        .where(eq(bill.id, r.id));
      return { ...r, sponsorships };
    });
    summary.bills[
      result.action === 'unchanged'
        ? result.sponsorships
          ? 'updated'
          : 'unchanged'
        : result.action
    ]++;
    return result.id;
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
          const id = await importHouseVote(session, v.rollCallNumber, before);
          const [row] = await db.select().from(rollCallVote).where(eq(rollCallVote.id, id));
          existing.set(`${session}:${v.rollCallNumber}`, row!);
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
    return result.id;
  }

  /** LIS member ID ("S428") -> Bioguide ID, from congress-legislators. */
  async function loadLisMap(files: string[], into: Map<string, string>) {
    for (const file of files) {
      const body = await api.getRaw(
        new URL(file, opts.legislatorsBaseUrl ?? LEGISLATORS_BASE),
        'application/json',
      );
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error(`${file} is not JSON.`);
      }
      const parsed = legislatorFileSchema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `${file} is not in the expected format (${issue?.path.join('.')}: ${issue?.message}). Nothing more was imported.`,
        );
      }
      for (const l of parsed.data) {
        if (l.id.lis && !into.has(l.id.lis)) into.set(l.id.lis, l.id.bioguide);
      }
    }
  }

  async function importSenateVotes() {
    const s = summary.senateVotes!;
    const existing = new Map(
      (
        await db
          .select()
          .from(rollCallVote)
          .where(and(eq(rollCallVote.chamber, 'senate'), eq(rollCallVote.congress, congress)))
      ).map((r) => [`${r.session}:${r.rollNumber}`, r] as const),
    );
    const [first] = congressYears(congress);
    const thisYear = Number(today.slice(0, 4));
    const lis = new Map<string, string>();
    let historicalLoaded = false;
    const unknownLis = new Set<string>();
    let detailed = 0;
    for (const session of [1, 2]) {
      if (first + session - 1 > thisYear) break;
      const menu = await api.getSenateXml(
        senateVoteMenuUrl(congress, session).replace(
          SENATE_BASE,
          opts.senateBaseUrl ?? SENATE_BASE,
        ),
        senateVoteMenuSchema,
        `Senate votes, ${congress}th Congress, session ${session}`,
      );
      const m = menu.vote_summary;
      if (m.congress !== congress || m.session !== session) {
        throw new Error(
          `Asked senate.gov for the ${congress}th Congress, session ${session}, and got the ${m.congress}th, session ${m.session}.`,
        );
      }
      // The menu lists the newest first; import oldest first, so a capped run leaves
      // the newest for next time and the stored record has no gaps in the middle.
      const numbers = [...new Set(m.votes.map((v) => v.vote_number))].sort((a, b) => a - b);
      for (const roll of numbers) {
        s.listed++;
        const before = existing.get(`${session}:${roll}`);
        // An empty stamp marks a vote stored with members we couldn't attach: try again.
        if (before && before.sourceUpdatedAt !== '' && !opts.refreshSenateVotes) {
          s.unchanged++;
          continue;
        }
        if (opts.maxVotes != null && detailed >= opts.maxVotes) {
          s.deferred++;
          continue;
        }
        detailed++;
        if (!lis.size) await loadLisMap(['legislators-current.json'], lis);
        await importSenateVote(session, roll, before);
      }
    }

    async function importSenateVote(
      session: number,
      roll: number,
      before?: typeof rollCallVote.$inferSelect,
    ) {
      const label = `Senate roll call ${roll} (${congress}th Congress, session ${session})`;
      const { roll_call_vote: v } = await api.getSenateXml(
        senateVoteXmlUrl(congress, session, roll).replace(
          SENATE_BASE,
          opts.senateBaseUrl ?? SENATE_BASE,
        ),
        senateVoteSchema,
        label,
      );
      if (v.vote_number !== roll || v.session !== session || v.congress !== congress) {
        throw new Error(
          `Asked senate.gov for ${label} and got roll call ${v.vote_number} (${v.congress}th Congress, session ${v.session}).`,
        );
      }
      const votedAt = parseSenateDateTime(v.vote_date);
      if (!votedAt) {
        throw new Error(
          `${label}: the vote date “${v.vote_date}” is not in the expected form. Nothing more was imported.`,
        );
      }
      // A senator who joined after congress-legislators' current file was loaded, or who
      // has since left, may only be in the historical file. Load it once, when needed.
      if (!historicalLoaded && v.members.member.some((p) => !lis.has(p.lis_member_id))) {
        historicalLoaded = true;
        await loadLisMap(['legislators-historical.json'], lis);
      }
      const year = votedAt.getUTCFullYear();
      const stamp = v.modify_date ?? v.vote_date;
      if (before && before.sourceUpdatedAt === stamp) {
        s.unchanged++;
        return;
      }
      const positions = new Map<string, typeof votePosition.$inferInsert>();
      let incomplete = false;
      for (const p of v.members.member) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
        const bioguideId = lis.get(p.lis_member_id);
        if (!bioguideId) {
          incomplete = true;
          if (!unknownLis.has(p.lis_member_id)) {
            unknownLis.add(p.lis_member_id);
            summary.attention.push({
              ref: `Senate LIS ID ${p.lis_member_id}`,
              name: name || p.lis_member_id,
              problem:
                'congress-legislators has no member with this Senate ID yet, so their Senate votes were not stored. Votes that include them are fetched again on the next run.',
            });
          }
          continue;
        }
        see(bioguideId, name, p.state);
        if (positions.has(bioguideId)) {
          summary.attention.push({
            ref: `Senate roll call ${roll}, ${year}`,
            name: bioguideId,
            problem: 'This senator is listed twice in the vote; the first entry was kept.',
          });
          continue;
        }
        positions.set(bioguideId, {
          voteId: 0,
          bioguideId,
          voteCast: p.vote_cast,
          party: p.party?.slice(0, 10) ?? null,
          state: p.state,
        });
      }
      const measure = senateVoteMeasure(v);
      const tie =
        v.tie_breaker?.by_whom && v.tie_breaker.tie_breaker_vote
          ? ` (tie broken by the ${v.tie_breaker.by_whom}: ${v.tie_breaker.tie_breaker_vote})`
          : '';
      const result = await db.transaction(async (tx) => {
        const sourceId = await ensureImportSource(
          tx,
          actor,
          {
            url: senateVotePageUrl(congress, session, roll),
            title: `Senate roll call ${roll}, ${year}${v.vote_title ? `: ${v.vote_title}` : v.question ? `: ${v.question}` : ''}`,
            publisher: 'U.S. Senate',
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
            chamber: 'senate',
            congress,
            session,
            rollNumber: roll,
            votedAt,
            question: (v.vote_question_text ?? v.question)?.slice(0, 500) ?? null,
            voteType: v.majority_requirement
              ? `${v.majority_requirement} majority required`.slice(0, 100)
              : null,
            result: `${v.vote_result ?? v.vote_result_text ?? ''}${tie}`.slice(0, 100) || null,
            legislationType: measure?.type.slice(0, 20) ?? null,
            legislationNumber: measure?.number.slice(0, 20) ?? null,
            sourceId,
            sourceUpdatedAt: incomplete ? '' : stamp.slice(0, 40),
          },
          `From senate.gov; ${positions.size} senators recorded`,
        );
        const rows = [...positions.values()].map((p) => ({ ...p, voteId: r.id }));
        if (r.action === 'unchanged') {
          // Fetched again only because it was incomplete: rewrite the positions only if
          // someone new can now be attached.
          const key = (p: typeof votePosition.$inferInsert) =>
            [p.bioguideId, p.voteCast, p.party, p.state].join('|');
          const stored = await tx.select().from(votePosition).where(eq(votePosition.voteId, r.id));
          const same =
            stored.length === rows.length &&
            new Set(stored.map(key)).size === new Set([...stored.map(key), ...rows.map(key)]).size;
          if (same) return { ...r, positionsChanged: false };
        }
        await tx.delete(votePosition).where(eq(votePosition.voteId, r.id));
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(votePosition).values(rows.slice(i, i + 500));
        }
        return { ...r, positionsChanged: true };
      });
      if (result.positionsChanged) s.positions += positions.size;
      s[
        result.action === 'unchanged'
          ? result.positionsChanged
            ? 'updated'
            : 'unchanged'
          : result.action
      ]++;
    }
  }
}

// ---------------------------------------------------------------------------------
// Reading

/**
 * A person's congressional record, through their Bioguide ID(s). With `publicOnly`,
 * leaves out the records an editor unpublished or archived: imported records are shown
 * as they come from Congress.gov and senate.gov unless an editor takes one down.
 */
export async function getCongressRecord(
  db: Db,
  personId: number,
  limit = 20,
  { publicOnly = false }: { publicOnly?: boolean } = {},
) {
  const shown = (t: { publishState: MySqlColumn }) =>
    publicOnly ? notInArray(t.publishState, ['unpublished', 'archived']) : undefined;
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
    .where(and(inArray(congressMembership.bioguideId, ids), shown(congressMembership)))
    .orderBy(desc(congressMembership.congress));
  const [sponsored] = await db
    .select({
      sponsor: sql<number>`sum(${billSponsorship.role} = 'sponsor')`,
      cosponsor: sql<number>`sum(${billSponsorship.role} = 'cosponsor')`,
    })
    .from(billSponsorship)
    .innerJoin(bill, eq(bill.id, billSponsorship.billId))
    .where(and(inArray(billSponsorship.bioguideId, ids), shown(bill)));
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
    .where(and(inArray(billSponsorship.bioguideId, ids), shown(bill)))
    .orderBy(desc(billSponsorship.sponsoredOn), desc(bill.id))
    .limit(limit);
  const [voteCount] = await db
    .select({ n: count() })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .where(and(inArray(votePosition.bioguideId, ids), shown(rollCallVote)));
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
      sourceUrl: source.url,
    })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .leftJoin(source, eq(source.id, rollCallVote.sourceId))
    .where(and(inArray(votePosition.bioguideId, ids), shown(rollCallVote)))
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
