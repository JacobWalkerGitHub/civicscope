import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';

const { jurisdiction, resultArea, resultCandidate, resultContest, resultFeed } = schema;

export interface ResultStateSummary {
  state: string;
  stateName: string;
  electionDate: string;
  publicUrl: string | null;
  sourceUrl: string;
  fetchedAt: Date | null;
  changedAt: Date | null;
  error: string | null;
  contests: number;
  /** The contest on the most ballots in the state (the governor, a Senate seat). */
  headline: {
    id: number;
    name: string;
    precinctsTotal: number | null;
    precinctsReporting: number | null;
    totalVotes: number;
  } | null;
}

/** Share of precincts counted, 0 to 1, or null when the state doesn't say. */
export function reportingShare(c: {
  precinctsTotal: number | null;
  precinctsReporting: number | null;
}): number | null {
  if (!c.precinctsTotal) return null;
  return Math.min(1, (c.precinctsReporting ?? 0) / c.precinctsTotal);
}

/** The election days that have results stored, newest first. */
export async function listResultDates(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ d: resultFeed.electionDate })
    .from(resultFeed)
    .orderBy(desc(resultFeed.electionDate));
  return rows.map((r) => r.d);
}

/** Every state with results for an election day, with its headline contest. */
export async function listResultStates(
  db: Db,
  electionDate: string,
): Promise<ResultStateSummary[]> {
  const feeds = await db
    .select({ feed: resultFeed, stateName: jurisdiction.name })
    .from(resultFeed)
    .leftJoin(jurisdiction, eq(jurisdiction.uspsCode, resultFeed.state))
    .where(eq(resultFeed.electionDate, electionDate))
    .orderBy(asc(resultFeed.state));
  if (feeds.length === 0) return [];
  const contests = await db
    .select({
      id: resultContest.id,
      feedId: resultContest.feedId,
      name: resultContest.name,
      group: resultContest.group,
      sort: resultContest.sort,
      precinctsTotal: resultContest.precinctsTotal,
      precinctsReporting: resultContest.precinctsReporting,
      totalVotes: resultContest.totalVotes,
    })
    .from(resultContest)
    .where(
      inArray(
        resultContest.feedId,
        feeds.map((f) => f.feed.id),
      ),
    );
  return feeds.map(({ feed, stateName }) => {
    const mine = contests.filter((c) => c.feedId === feed.id);
    // Statewide contests are on every ballot: the one with the most precincts, and of
    // those the first the state lists.
    const headline =
      [...mine]
        .filter((c) => c.group === 'federal' || c.group === 'statewide')
        .sort((a, b) => (b.precinctsTotal ?? 0) - (a.precinctsTotal ?? 0) || a.sort - b.sort)[0] ??
      null;
    return {
      state: feed.state,
      stateName: stateName ?? feed.state,
      electionDate: feed.electionDate,
      publicUrl: feed.publicUrl,
      sourceUrl: feed.sourceUrl,
      fetchedAt: feed.fetchedAt,
      changedAt: feed.changedAt,
      error: feed.error,
      contests: mine.length,
      headline: headline && {
        id: headline.id,
        name: headline.name,
        precinctsTotal: headline.precinctsTotal,
        precinctsReporting: headline.precinctsReporting,
        totalVotes: headline.totalVotes,
      },
    };
  });
}

export interface ResultContestView {
  id: number;
  name: string;
  group: (typeof resultContest.$inferSelect)['group'];
  voteFor: number;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
  totalVotes: number;
  hasAreas: boolean;
  /** Most votes first once counting starts; alphabetical before any votes are in. */
  candidates: { key: string; name: string; party: string | null; votes: number }[];
}

const byVotes = <T extends { votes: number; name: string }>(list: T[]) =>
  [...list].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

/** One state's results for an election day, every contest in the state's order. */
export async function getStateResults(db: Db, state: string, electionDate: string) {
  const [summary] = (await listResultStates(db, electionDate)).filter(
    (s) => s.state === state.toUpperCase(),
  );
  if (!summary) return null;
  const [feed] = await db
    .select({ id: resultFeed.id })
    .from(resultFeed)
    .where(and(eq(resultFeed.state, summary.state), eq(resultFeed.electionDate, electionDate)));
  const contests = await db
    .select()
    .from(resultContest)
    .where(eq(resultContest.feedId, feed!.id))
    .orderBy(asc(resultContest.sort));
  const ids = contests.map((c) => c.id);
  const candidates = ids.length
    ? await db.select().from(resultCandidate).where(inArray(resultCandidate.contestId, ids))
    : [];
  const withAreas = new Set(
    ids.length
      ? (
          await db
            .selectDistinct({ id: resultArea.contestId })
            .from(resultArea)
            .where(inArray(resultArea.contestId, ids))
        ).map((r) => r.id)
      : [],
  );
  const byContest = new Map<number, typeof candidates>();
  for (const c of candidates)
    byContest.set(c.contestId, [...(byContest.get(c.contestId) ?? []), c]);
  const view: ResultContestView[] = contests.map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group,
    voteFor: c.voteFor,
    precinctsTotal: c.precinctsTotal,
    precinctsReporting: c.precinctsReporting,
    totalVotes: c.totalVotes,
    hasAreas: withAreas.has(c.id),
    candidates: byVotes(
      (byContest.get(c.id) ?? []).map(({ key, name, party, votes }) => ({
        key,
        name,
        party,
        votes,
      })),
    ),
  }));
  return { summary, contests: view };
}

/** One contest with its county-by-county numbers. */
export async function getContestResults(db: Db, contestId: number) {
  const [row] = await db
    .select({ contest: resultContest, feed: resultFeed, stateName: jurisdiction.name })
    .from(resultContest)
    .innerJoin(resultFeed, eq(resultFeed.id, resultContest.feedId))
    .leftJoin(jurisdiction, eq(jurisdiction.uspsCode, resultFeed.state))
    .where(eq(resultContest.id, contestId));
  if (!row) return null;
  const candidates = byVotes(
    await db
      .select({
        key: resultCandidate.key,
        name: resultCandidate.name,
        party: resultCandidate.party,
        votes: resultCandidate.votes,
      })
      .from(resultCandidate)
      .where(eq(resultCandidate.contestId, contestId)),
  );
  const areas = await db
    .select({
      code: resultArea.code,
      name: resultArea.name,
      precinctsTotal: resultArea.precinctsTotal,
      precinctsReporting: resultArea.precinctsReporting,
      votes: resultArea.votes,
    })
    .from(resultArea)
    .where(eq(resultArea.contestId, contestId))
    .orderBy(asc(resultArea.name));
  return {
    contest: row.contest,
    feed: row.feed,
    stateName: row.stateName ?? row.feed.state,
    candidates,
    areas,
  };
}
