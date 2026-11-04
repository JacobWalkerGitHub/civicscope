/**
 * The public record part of a side-by-side comparison: time in Congress, bills, how many
 * recorded votes each candidate has, and the roll calls two or more of them voted on.
 *
 * Everything here comes from the chambers' own records (Congress.gov, the House Clerk,
 * senate.gov) and from state legislatures through Open States. A candidate with no such
 * record gets none: nothing is inferred from party or from anyone else's votes.
 */
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import { getCongressRecord } from './congress-import';
import { getStateVotes } from './openstates';

const {
  personIdentifier,
  rollCallVote,
  votePosition,
  source,
  stateVote,
  stateVotePosition,
  stateBill,
} = schema;

/** How many shared roll calls to list, newest first. */
export const SHARED_VOTES_MAX = 10;

export interface CompareSeat {
  chamber: 'house' | 'senate';
  state: string;
  district: string | null;
  startYear: number;
  endYear: number | null;
}

export interface CompareRecord {
  bioguideId: string | null;
  /** Seats in Congress, one per chamber, state and district, earliest start to latest end. */
  seats: CompareSeat[];
  sponsorCount: number;
  cosponsorCount: number;
  congressVotes: number;
  stateVotes: number;
}

/** Joins a person's terms into one line per seat: "House, VA-7, 2019–present". */
export function mergeSeats(
  memberships: {
    chamber: 'house' | 'senate';
    state: string;
    district: string | number | null;
    startYear: number;
    endYear: number | null;
  }[],
): CompareSeat[] {
  const seats = new Map<string, CompareSeat>();
  for (const m of memberships) {
    const district = m.chamber === 'house' && m.district != null ? String(m.district) : null;
    const key = `${m.chamber}:${m.state}:${district ?? ''}`;
    const seen = seats.get(key);
    if (!seen) {
      seats.set(key, { chamber: m.chamber, state: m.state, district, ...pick(m) });
      continue;
    }
    seen.startYear = Math.min(seen.startYear, m.startYear);
    // A null end year means the term is current, which outranks any year.
    seen.endYear =
      seen.endYear == null || m.endYear == null ? null : Math.max(seen.endYear, m.endYear);
  }
  return [...seats.values()].sort((a, b) => (b.endYear ?? 9999) - (a.endYear ?? 9999));
}
const pick = (m: { startYear: number; endYear: number | null }) => ({
  startYear: m.startYear,
  endYear: m.endYear,
});

async function identifiers(db: Db, personIds: number[], scheme: 'bioguide' | 'openstates') {
  const out = new Map<number, string[]>();
  if (!personIds.length) return out;
  const rows = await db
    .select({ personId: personIdentifier.personId, value: personIdentifier.value })
    .from(personIdentifier)
    .where(and(inArray(personIdentifier.personId, personIds), eq(personIdentifier.scheme, scheme)));
  for (const r of rows) out.set(r.personId, [...(out.get(r.personId) ?? []), r.value]);
  return out;
}

/** Each person's record summary, keyed by person ID. */
export async function getCompareRecords(
  db: Db,
  personIds: number[],
  { preview = false }: { preview?: boolean } = {},
): Promise<Map<number, CompareRecord>> {
  const entries = await Promise.all(
    personIds.map(async (pid) => {
      const [congress, state] = await Promise.all([
        getCongressRecord(db, pid, 1, { publicOnly: !preview }),
        getStateVotes(db, pid, 1),
      ]);
      const record: CompareRecord = {
        bioguideId: congress?.bioguideIds[0] ?? null,
        seats: mergeSeats(congress?.memberships ?? []),
        sponsorCount: congress?.sponsorCount ?? 0,
        cosponsorCount: congress?.cosponsorCount ?? 0,
        congressVotes: congress?.voteCount ?? 0,
        stateVotes: state.total,
      };
      return [pid, record] as const;
    }),
  );
  return new Map(entries);
}

export interface SharedCongressVote {
  id: number;
  chamber: 'house' | 'senate';
  rollNumber: number;
  votedAt: Date;
  question: string | null;
  result: string | null;
  legislationType: string | null;
  legislationNumber: string | null;
  sourceUrl: string | null;
  /** How each person voted, by person ID. Missing means they did not vote on it. */
  cast: Map<number, string>;
}

export interface SharedStateVote {
  id: number;
  votedOn: string;
  motion: string;
  result: string;
  sourceUrl: string | null;
  bill: { state: string; session: string; identifier: string; title: string; url: string | null };
  cast: Map<number, string>;
}

/**
 * The most recent roll calls on which at least two of these people have a recorded
 * vote, in Congress and in state legislatures, with how each of them voted.
 */
export async function getSharedVotes(
  db: Db,
  personIds: number[],
  { preview = false, limit = SHARED_VOTES_MAX }: { preview?: boolean; limit?: number } = {},
): Promise<{ congress: SharedCongressVote[]; state: SharedStateVote[] }> {
  if (personIds.length < 2) return { congress: [], state: [] };
  const [bioguide, openstates] = await Promise.all([
    identifiers(db, personIds, 'bioguide'),
    identifiers(db, personIds, 'openstates'),
  ]);
  return {
    congress: await sharedCongress(db, bioguide, limit, preview),
    state: await sharedState(db, openstates, limit),
  };
}

/** Identifier → person, for people who have at least one; needs two people to share votes. */
function owners(ids: Map<number, string[]>) {
  const owner = new Map<string, number>();
  for (const [pid, list] of ids) for (const v of list) owner.set(v, pid);
  return new Set(ids.keys()).size >= 2 ? owner : null;
}

async function sharedCongress(
  db: Db,
  ids: Map<number, string[]>,
  limit: number,
  preview: boolean,
): Promise<SharedCongressVote[]> {
  const owner = owners(ids);
  if (!owner) return [];
  const all = [...owner.keys()];
  const shown = preview
    ? undefined
    : notInArray(rollCallVote.publishState, ['unpublished', 'archived']);
  const top = await db
    .select({ id: votePosition.voteId })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .where(and(inArray(votePosition.bioguideId, all), shown))
    .groupBy(votePosition.voteId, rollCallVote.votedAt)
    .having(sql`count(distinct ${votePosition.bioguideId}) >= 2`)
    .orderBy(desc(rollCallVote.votedAt), desc(votePosition.voteId))
    .limit(limit);
  if (!top.length) return [];
  const voteIds = top.map((t) => t.id);
  const votes = await db
    .select({
      id: rollCallVote.id,
      chamber: rollCallVote.chamber,
      rollNumber: rollCallVote.rollNumber,
      votedAt: rollCallVote.votedAt,
      question: rollCallVote.question,
      result: rollCallVote.result,
      legislationType: rollCallVote.legislationType,
      legislationNumber: rollCallVote.legislationNumber,
      sourceUrl: source.url,
    })
    .from(rollCallVote)
    .leftJoin(source, eq(source.id, rollCallVote.sourceId))
    .where(inArray(rollCallVote.id, voteIds))
    .orderBy(desc(rollCallVote.votedAt), desc(rollCallVote.id));
  const positions = await db
    .select({
      voteId: votePosition.voteId,
      bioguideId: votePosition.bioguideId,
      cast: votePosition.voteCast,
    })
    .from(votePosition)
    .where(and(inArray(votePosition.voteId, voteIds), inArray(votePosition.bioguideId, all)));
  return votes.map((v) => ({
    ...v,
    cast: new Map(
      positions
        .filter((p) => p.voteId === v.id)
        .map((p) => [owner.get(p.bioguideId)!, p.cast] as const),
    ),
  }));
}

async function sharedState(
  db: Db,
  ids: Map<number, string[]>,
  limit: number,
): Promise<SharedStateVote[]> {
  const owner = owners(ids);
  if (!owner) return [];
  const all = [...owner.keys()];
  const top = await db
    .select({ id: stateVotePosition.voteId })
    .from(stateVotePosition)
    .innerJoin(stateVote, eq(stateVote.id, stateVotePosition.voteId))
    .where(inArray(stateVotePosition.osPersonId, all))
    .groupBy(stateVotePosition.voteId, stateVote.votedOn)
    .having(sql`count(distinct ${stateVotePosition.osPersonId}) >= 2`)
    .orderBy(desc(stateVote.votedOn), desc(stateVotePosition.voteId))
    .limit(limit);
  if (!top.length) return [];
  const voteIds = top.map((t) => t.id);
  const votes = await db
    .select({
      id: stateVote.id,
      votedOn: stateVote.votedOn,
      motion: stateVote.motion,
      result: stateVote.result,
      sourceUrl: stateVote.sourceUrl,
      state: stateBill.state,
      session: stateBill.session,
      identifier: stateBill.identifier,
      title: stateBill.title,
      url: stateBill.openstatesUrl,
    })
    .from(stateVote)
    .innerJoin(stateBill, eq(stateBill.id, stateVote.billId))
    .where(inArray(stateVote.id, voteIds))
    .orderBy(desc(stateVote.votedOn), desc(stateVote.id));
  const positions = await db
    .select({
      voteId: stateVotePosition.voteId,
      osPersonId: stateVotePosition.osPersonId,
      option: stateVotePosition.option,
    })
    .from(stateVotePosition)
    .where(
      and(inArray(stateVotePosition.voteId, voteIds), inArray(stateVotePosition.osPersonId, all)),
    );
  return votes.map(({ state, session, identifier, title, url, ...v }) => ({
    ...v,
    bill: { state, session, identifier, title, url },
    cast: new Map(
      positions
        .filter((p) => p.voteId === v.id && p.osPersonId)
        .map((p) => [owner.get(p.osPersonId!)!, p.option] as const),
    ),
  }));
}
