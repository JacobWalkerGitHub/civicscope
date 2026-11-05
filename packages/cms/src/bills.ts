/**
 * Read queries for the public Bills and Politicians pages: bills of Congress with their
 * sponsors and roll-call votes, and the Members of Congress who sponsor and vote on
 * them. Everything here comes from Congress.gov, Voteview and senate.gov (see congress-import.ts)
 * and is shown as imported unless an editor unpublishes or archives a record.
 *
 * Members are identified by Bioguide ID. A member's name comes from the Congress.gov
 * member list; their profile link appears only when a published CivicScope person
 * carries that Bioguide ID.
 */
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import {
  billLabel,
  congressGovBillUrl,
  congressOn,
  FINAL_BILL_STAGES,
  isBillType,
  memberDisplayName,
  todayIso,
  type BillStage,
  type BillType,
  type CongressChamber,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';

const {
  bill,
  billSponsorship,
  congressMembership,
  person,
  personIdentifier,
  rollCallVote,
  source,
  votePosition,
} = schema;

/** Imported records are public until an editor takes one down. */
const shown = (t: { publishState: MySqlColumn }) =>
  notInArray(t.publishState, ['unpublished', 'archived']);

export const BILL_TABS = ['outcomes', 'progress', 'all'] as const;
export type BillTab = (typeof BILL_TABS)[number];
export const BILL_PAGE_SIZE = 30;

export interface BillFilters {
  tab?: BillTab;
  /** Words in the title, or a bill number such as "HR 3424". */
  q?: string;
  congress?: number;
  chamber?: CongressChamber;
  stage?: BillStage;
  policyArea?: string;
}

const HOUSE_TYPES: BillType[] = ['hr', 'hres', 'hjres', 'hconres'];
const SENATE_TYPES: BillType[] = ['s', 'sres', 'sjres', 'sconres'];

/** "HR 3424", "h.r.3424", "S. 5" -> type and number. */
export function parseBillNumber(q: string): { type: BillType; number: number } | null {
  const m = /^\s*([a-z.\s]+?)\s*(\d+)\s*$/i.exec(q);
  if (!m) return null;
  const type = m[1]!.toLowerCase().replace(/[.\s]/g, '');
  if (!isBillType(type)) return null;
  return { type, number: Number(m[2]) };
}

function billWhere(filters: BillFilters): SQL {
  const q = filters.q?.trim().slice(0, 200);
  const num = q ? parseBillNumber(q) : null;
  const tab = filters.tab ?? 'all';
  return and(
    shown(bill),
    filters.congress ? eq(bill.congress, filters.congress) : undefined,
    filters.chamber
      ? inArray(bill.billType, filters.chamber === 'house' ? HOUSE_TYPES : SENATE_TYPES)
      : undefined,
    filters.stage ? eq(bill.stage, filters.stage) : undefined,
    filters.policyArea ? eq(bill.policyArea, filters.policyArea) : undefined,
    tab === 'outcomes' ? inArray(bill.stage, [...FINAL_BILL_STAGES]) : undefined,
    tab === 'progress'
      ? or(isNull(bill.stage), notInArray(bill.stage, [...FINAL_BILL_STAGES]))
      : undefined,
    num
      ? and(eq(bill.billType, num.type), eq(bill.number, num.number))
      : q
        ? like(bill.title, `%${q.replace(/[%_\\]/g, '\\$&')}%`)
        : undefined,
  )!;
}

/** Sponsor names for many bills at once, keyed by bill ID. */
async function sponsorsFor(db: Db, billIds: number[]) {
  const out = new Map<number, { bioguideId: string; party: string | null; state: string | null }>();
  if (!billIds.length) return out;
  const rows = await db
    .select({
      billId: billSponsorship.billId,
      bioguideId: billSponsorship.bioguideId,
      party: billSponsorship.party,
      state: billSponsorship.state,
    })
    .from(billSponsorship)
    .where(and(inArray(billSponsorship.billId, billIds), eq(billSponsorship.role, 'sponsor')));
  for (const r of rows) if (!out.has(r.billId)) out.set(r.billId, r);
  return out;
}

export interface MemberRef {
  bioguideId: string;
  name: string;
  /** Set when a published CivicScope profile carries this Bioguide ID. */
  personSlug: string | null;
  /** The photo on that published profile, if it has one. */
  photoId: number | null;
}

/** Names and profile links for Members of Congress, by Bioguide ID. */
export async function memberRefs(db: Db, ids: string[]): Promise<Map<string, MemberRef>> {
  const out = new Map<string, MemberRef>();
  const unique = [...new Set(ids)];
  if (!unique.length) return out;
  const names = await db
    .select({
      bioguideId: congressMembership.bioguideId,
      memberName: congressMembership.memberName,
      congress: congressMembership.congress,
    })
    .from(congressMembership)
    .where(inArray(congressMembership.bioguideId, unique))
    .orderBy(desc(congressMembership.congress));
  const people = await db
    .select({
      value: personIdentifier.value,
      slug: person.slug,
      fullName: person.fullName,
      publishState: person.publishState,
      photoId: person.photoId,
    })
    .from(personIdentifier)
    .innerJoin(person, eq(person.id, personIdentifier.personId))
    .where(
      and(
        eq(personIdentifier.scheme, 'bioguide'),
        inArray(personIdentifier.value, unique),
        isNull(person.deletedAt),
      ),
    );
  for (const id of unique) {
    const n = names.find((r) => r.bioguideId === id && r.memberName);
    const p = people.find((r) => r.value === id);
    out.set(id, {
      bioguideId: id,
      name: n?.memberName ? memberDisplayName(n.memberName) : (p?.fullName ?? `Member ${id}`),
      personSlug: p?.publishState === 'published' ? p.slug : null,
      photoId: p?.publishState === 'published' ? p.photoId : null,
    });
  }
  return out;
}

/** One page of bills for the Bills tab. */
export async function listPublicBills(db: Db, filters: BillFilters = {}, page = 1) {
  const where = billWhere(filters);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(bill)
    .where(where);
  const rows = await db
    .select({
      id: bill.id,
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      introducedOn: bill.introducedOn,
      policyArea: bill.policyArea,
      latestActionOn: bill.latestActionOn,
      latestActionText: bill.latestActionText,
      stage: bill.stage,
      hasSummary: sql<number>`${bill.summary} is not null`,
    })
    .from(bill)
    .where(where)
    .orderBy(
      sql`${bill.latestActionOn} is null`,
      desc(bill.latestActionOn),
      desc(bill.congress),
      asc(bill.billType),
      desc(bill.number),
    )
    .limit(BILL_PAGE_SIZE)
    .offset((safePage - 1) * BILL_PAGE_SIZE);
  const sponsors = await sponsorsFor(
    db,
    rows.map((r) => r.id),
  );
  const refs = await memberRefs(
    db,
    [...sponsors.values()].map((s) => s.bioguideId),
  );
  return {
    rows: rows.map((r) => {
      const s = sponsors.get(r.id);
      return {
        ...r,
        hasSummary: Boolean(Number(r.hasSummary)),
        label: billLabel(r.billType, r.number),
        sponsor: s ? { ...refs.get(s.bioguideId)!, party: s.party, state: s.state } : null,
      };
    }),
    total: Number(countRow?.n ?? 0),
    page: safePage,
  };
}

/** Counts for the Bills tab headers and the choices for its filters. */
export async function billOverview(db: Db) {
  const stages = await db
    .select({ stage: bill.stage, n: sql<number>`count(*)` })
    .from(bill)
    .where(shown(bill))
    .groupBy(bill.stage);
  const congresses = await db
    .selectDistinct({ congress: bill.congress })
    .from(bill)
    .where(shown(bill))
    .orderBy(desc(bill.congress));
  const policyAreas = await db
    .selectDistinct({ name: bill.policyArea })
    .from(bill)
    .where(and(shown(bill), sql`${bill.policyArea} is not null`))
    .orderBy(asc(bill.policyArea));
  const byStage = Object.fromEntries(stages.map((s) => [s.stage ?? 'unknown', Number(s.n)]));
  const total = stages.reduce((n, s) => n + Number(s.n), 0);
  const outcomes = FINAL_BILL_STAGES.reduce((n, s) => n + (byStage[s] ?? 0), 0);
  return {
    total,
    outcomes,
    progress: total - outcomes,
    byStage,
    congresses: congresses.map((c) => c.congress),
    policyAreas: policyAreas.map((p) => p.name!).filter(Boolean),
  };
}

/** SQL matching a roll-call vote to the bill it was on ("H.R.", "HR" and "hr" alike). */
export const voteIsOnBill = (b: { congress: number; billType: BillType; number: number }) =>
  and(
    eq(rollCallVote.congress, b.congress),
    sql`lower(replace(replace(${rollCallVote.legislationType}, '.', ''), ' ', '')) = ${b.billType}`,
    eq(rollCallVote.legislationNumber, String(b.number)),
  );

/** How a vote cast counts in a tally. */
export function voteSide(cast: string): 'yes' | 'no' | 'present' | 'absent' | 'other' {
  const c = cast.toLowerCase();
  if (c === 'yea' || c === 'aye' || c === 'yes') return 'yes';
  if (c === 'nay' || c === 'no') return 'no';
  if (c === 'present') return 'present';
  if (c === 'not voting') return 'absent';
  return 'other';
}

/** A bill's public page: the bill, its sponsors, its summary and every recorded vote on it. */
export async function getPublicBill(db: Db, congress: number, type: string, number: number) {
  if (!isBillType(type)) return null;
  const [b] = await db
    .select({
      id: bill.id,
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      introducedOn: bill.introducedOn,
      policyArea: bill.policyArea,
      latestActionOn: bill.latestActionOn,
      latestActionText: bill.latestActionText,
      stage: bill.stage,
      summary: bill.summary,
      summaryVersion: bill.summaryVersion,
      summaryDate: bill.summaryDate,
      textUrl: bill.textUrl,
      textVersion: bill.textVersion,
      textDate: bill.textDate,
      sourceUrl: source.url,
      retrievedAt: source.retrievedAt,
      updatedAt: bill.updatedAt,
      sourceCheckedAt: bill.sourceCheckedAt,
    })
    .from(bill)
    .innerJoin(source, eq(source.id, bill.sourceId))
    .where(
      and(
        eq(bill.congress, congress),
        eq(bill.billType, type),
        eq(bill.number, number),
        shown(bill),
      ),
    );
  if (!b) return null;

  const sponsorRows = await db
    .select()
    .from(billSponsorship)
    .where(eq(billSponsorship.billId, b.id))
    .orderBy(asc(billSponsorship.role), asc(billSponsorship.sponsoredOn), asc(billSponsorship.id));

  const votes = await db
    .select({
      id: rollCallVote.id,
      chamber: rollCallVote.chamber,
      congress: rollCallVote.congress,
      session: rollCallVote.session,
      rollNumber: rollCallVote.rollNumber,
      votedAt: rollCallVote.votedAt,
      question: rollCallVote.question,
      voteType: rollCallVote.voteType,
      result: rollCallVote.result,
      sourceUrl: source.url,
      sourcePublisher: source.publisher,
    })
    .from(rollCallVote)
    .innerJoin(source, eq(source.id, rollCallVote.sourceId))
    .where(and(voteIsOnBill(b), shown(rollCallVote)))
    .orderBy(desc(rollCallVote.votedAt));
  const positions = votes.length
    ? await db
        .select({
          voteId: votePosition.voteId,
          bioguideId: votePosition.bioguideId,
          voteCast: votePosition.voteCast,
          party: votePosition.party,
          state: votePosition.state,
        })
        .from(votePosition)
        .where(
          inArray(
            votePosition.voteId,
            votes.map((v) => v.id),
          ),
        )
    : [];
  const refs = await memberRefs(db, [
    ...sponsorRows.map((s) => s.bioguideId),
    ...positions.map((p) => p.bioguideId),
  ]);
  const byName = new Intl.Collator('en', { sensitivity: 'base' });
  const lastName = (n: string) => n.split(' ').at(-1) ?? n;

  return {
    bill: {
      ...b,
      label: billLabel(b.billType, b.number),
      congressGovUrl: congressGovBillUrl(b.congress, b.billType, b.number),
    },
    sponsors: sponsorRows
      .filter((s) => s.role === 'sponsor')
      .map((s) => ({
        ...refs.get(s.bioguideId)!,
        party: s.party,
        state: s.state,
        on: s.sponsoredOn,
      })),
    cosponsors: sponsorRows
      .filter((s) => s.role === 'cosponsor')
      .map((s) => ({
        ...refs.get(s.bioguideId)!,
        party: s.party,
        state: s.state,
        on: s.sponsoredOn,
        isOriginal: s.isOriginal,
        withdrawnOn: s.withdrawnOn,
      })),
    votes: votes.map((v) => {
      const mine = positions
        .filter((p) => p.voteId === v.id)
        .map((p) => ({ ...p, ...refs.get(p.bioguideId)!, side: voteSide(p.voteCast) }))
        .sort((a, b) => byName.compare(lastName(a.name), lastName(b.name)));
      const tally = { yes: 0, no: 0, present: 0, absent: 0, other: 0 };
      const parties = new Map<string, typeof tally>();
      for (const p of mine) {
        tally[p.side]++;
        const key = p.party ?? '—';
        const t = parties.get(key) ?? { yes: 0, no: 0, present: 0, absent: 0, other: 0 };
        t[p.side]++;
        parties.set(key, t);
      }
      return {
        ...v,
        tally,
        byParty: [...parties.entries()]
          .sort(([a], [b]) => byName.compare(a, b))
          .map(([party, t]) => ({ party, ...t })),
        positions: mine,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------
// Politicians

export interface MemberFilters {
  q?: string;
  chamber?: CongressChamber;
  /** USPS code. */
  state?: string;
  party?: string;
}

/**
 * Members of Congress serving now: the sitting Congress's members whose term has not
 * ended, alphabetical by last name. Congress.gov gives a sitting member's term no end
 * year and sets one only once they leave, so any end year means they have gone. Comparing
 * it with this year kept members who left this year (two senators replaced in 2026
 * showed alongside their successors).
 */
export async function listCurrentMembers(db: Db, filters: MemberFilters = {}, today = todayIso()) {
  const [latest] = await db
    .select({ congress: sql<number>`max(${congressMembership.congress})` })
    .from(congressMembership)
    .where(shown(congressMembership));
  const congress = Math.min(Number(latest?.congress ?? 0), congressOn(today));
  if (!congress) return { congress: null, rows: [], parties: [], states: [] };
  const base = and(
    eq(congressMembership.congress, congress),
    shown(congressMembership),
    isNull(congressMembership.endYear),
  )!;
  const q = filters.q?.trim().slice(0, 100);
  const rows = await db
    .select({
      id: congressMembership.id,
      bioguideId: congressMembership.bioguideId,
      chamber: congressMembership.chamber,
      state: congressMembership.state,
      district: congressMembership.district,
      partyName: congressMembership.partyName,
      memberName: congressMembership.memberName,
      startYear: congressMembership.startYear,
    })
    .from(congressMembership)
    .where(
      and(
        base,
        filters.chamber ? eq(congressMembership.chamber, filters.chamber) : undefined,
        filters.state ? eq(congressMembership.state, filters.state.toUpperCase()) : undefined,
        filters.party ? eq(congressMembership.partyName, filters.party) : undefined,
        q ? like(congressMembership.memberName, `%${q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
      ),
    )
    .orderBy(asc(congressMembership.memberName), asc(congressMembership.id));
  const refs = await memberRefs(
    db,
    rows.map((r) => r.bioguideId),
  );
  const facets = await db
    .selectDistinct({ state: congressMembership.state, partyName: congressMembership.partyName })
    .from(congressMembership)
    .where(base);
  return {
    congress,
    rows: rows.map((r) => ({ ...r, ...refs.get(r.bioguideId)! })),
    parties: [...new Set(facets.map((f) => f.partyName).filter((p): p is string => !!p))].sort(),
    states: [...new Set(facets.map((f) => f.state))].sort(),
  };
}

/** A Member of Congress's public page: their seats, sponsored bills and recent votes. */
export async function getPublicMember(db: Db, bioguideId: string) {
  const memberships = await db
    .select({
      congress: congressMembership.congress,
      chamber: congressMembership.chamber,
      state: congressMembership.state,
      district: congressMembership.district,
      partyName: congressMembership.partyName,
      startYear: congressMembership.startYear,
      endYear: congressMembership.endYear,
      sourceUrl: source.url,
    })
    .from(congressMembership)
    .innerJoin(source, eq(source.id, congressMembership.sourceId))
    .where(and(eq(congressMembership.bioguideId, bioguideId), shown(congressMembership)))
    .orderBy(desc(congressMembership.congress), asc(congressMembership.chamber));
  if (!memberships.length) return null;
  const ref = (await memberRefs(db, [bioguideId])).get(bioguideId)!;
  const bills = await db
    .select({
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      title: bill.title,
      stage: bill.stage,
      latestActionOn: bill.latestActionOn,
      role: billSponsorship.role,
    })
    .from(billSponsorship)
    .innerJoin(bill, eq(bill.id, billSponsorship.billId))
    .where(and(eq(billSponsorship.bioguideId, bioguideId), shown(bill)))
    .orderBy(asc(billSponsorship.role), desc(bill.latestActionOn), desc(bill.id))
    .limit(60);
  const [counts] = await db
    .select({
      sponsor: sql<number>`coalesce(sum(${billSponsorship.role} = 'sponsor'), 0)`,
      cosponsor: sql<number>`coalesce(sum(${billSponsorship.role} = 'cosponsor'), 0)`,
    })
    .from(billSponsorship)
    .innerJoin(bill, eq(bill.id, billSponsorship.billId))
    .where(and(eq(billSponsorship.bioguideId, bioguideId), shown(bill)));
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
      sourceUrl: source.url,
      sourcePublisher: source.publisher,
    })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .innerJoin(source, eq(source.id, rollCallVote.sourceId))
    .where(and(eq(votePosition.bioguideId, bioguideId), shown(rollCallVote)))
    .orderBy(desc(rollCallVote.votedAt))
    .limit(25);
  return {
    member: ref,
    memberships,
    bills: bills.map((b) => ({ ...b, label: billLabel(b.billType, b.number) })),
    sponsorCount: Number(counts?.sponsor ?? 0),
    cosponsorCount: Number(counts?.cosponsor ?? 0),
    votes: votes.map((v) => {
      const type = v.legislationType?.toLowerCase().replace(/[.\s]/g, '') ?? '';
      const n = Number(v.legislationNumber);
      return {
        ...v,
        bill:
          isBillType(type) && Number.isInteger(n) && n > 0
            ? { congress: v.congress, billType: type, number: n, label: billLabel(type, n) }
            : null,
      };
    }),
  };
}
