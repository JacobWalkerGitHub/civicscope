import { createHash } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import { activeFeeds, type ResultFeedConfig } from './feeds';
import { PARSERS, type ParsedContest } from './parse';

const { ingestRun, resultArea, resultCandidate, resultContest, resultFeed } = schema;

export interface FeedReadSummary {
  state: string;
  electionDate: string;
  /** "changed" reloads the numbers; "unchanged" only records the read. */
  outcome: 'changed' | 'unchanged' | 'failed';
  contests?: number;
  error?: string;
}

export interface ResultsRunOptions {
  fetch?: typeof fetch;
  now?: Date;
  feeds?: ResultFeedConfig[];
}

/**
 * Reads every results file that is live now and stores what changed. One file failing
 * does not stop the others; the run is marked failed (so the hourly check raises an
 * alert) and the stored numbers stay as they were, with the error shown to admins.
 * With no file live, it returns at once without logging a run.
 */
export async function runResultsIngest(
  db: Db,
  opts: ResultsRunOptions = {},
): Promise<{ runId: number | null; feeds: FeedReadSummary[] }> {
  const feeds = opts.feeds ?? activeFeeds(opts.now ?? new Date());
  if (feeds.length === 0) return { runId: null, feeds: [] };

  const [run] = await db.insert(ingestRun).values({
    source: 'state_results',
    params: { states: feeds.map((f) => f.state) },
  });
  const out: FeedReadSummary[] = [];
  for (const f of feeds) out.push(await readFeed(db, f, opts.fetch ?? fetch));
  const failed = out.filter((f) => f.outcome === 'failed');
  await db
    .update(ingestRun)
    .set({
      state: failed.length ? 'failed' : 'succeeded',
      finishedAt: new Date(),
      summary: out,
      error: failed.length
        ? failed
            .map((f) => `${f.state}: ${f.error}`)
            .join('; ')
            .slice(0, 2000)
        : null,
    })
    .where(eq(ingestRun.id, run.insertId));
  return { runId: run.insertId, feeds: out };
}

async function fetchBody(url: string, doFetch: typeof fetch): Promise<string> {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(url, {
        // Ask every cache on the way for the state's latest copy: on election night a
        // copy even a few minutes old is wrong.
        headers: { accept: 'text/plain, application/json', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return await res.text();
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Could not read ${url}: ${last}`);
}

async function ensureFeed(db: Db, f: ResultFeedConfig) {
  await db
    .insert(resultFeed)
    .values({
      state: f.state,
      electionDate: f.electionDate,
      kind: f.kind,
      sourceUrl: f.url,
      publicUrl: f.publicUrl,
    })
    .onDuplicateKeyUpdate({
      set: { kind: f.kind, sourceUrl: f.url, publicUrl: f.publicUrl },
    });
  const [row] = await db
    .select()
    .from(resultFeed)
    .where(and(eq(resultFeed.state, f.state), eq(resultFeed.electionDate, f.electionDate)));
  return row!;
}

export async function readFeed(
  db: Db,
  f: ResultFeedConfig,
  doFetch: typeof fetch = fetch,
): Promise<FeedReadSummary> {
  const base = { state: f.state, electionDate: f.electionDate };
  const feed = await ensureFeed(db, f);
  try {
    const body = await fetchBody(f.url, doFetch);
    const hash = createHash('sha256').update(body).digest('hex');
    if (hash === feed.bodyHash) {
      await db
        .update(resultFeed)
        .set({ fetchedAt: new Date(), error: null })
        .where(eq(resultFeed.id, feed.id));
      return { ...base, outcome: 'unchanged' };
    }
    const contests = PARSERS[f.kind](body);
    if (contests.length === 0) throw new Error('The file has no contests in it.');
    await storeContests(db, feed.id, contests);
    const now = new Date();
    await db
      .update(resultFeed)
      .set({ bodyHash: hash, fetchedAt: now, changedAt: now, error: null })
      .where(eq(resultFeed.id, feed.id));
    return { ...base, outcome: 'changed', contests: contests.length };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await db.update(resultFeed).set({ error: message }).where(eq(resultFeed.id, feed.id));
    return { ...base, outcome: 'failed', error: message };
  }
}

const CHUNK = 500;
const chunks = <T>(list: T[]) =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) =>
    list.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * Replaces a feed's numbers with a fresh read in one transaction, so a visitor never
 * sees half an update. Contests keep their IDs between reads (pages link to them);
 * anything the state has dropped from its file is removed.
 */
export async function storeContests(db: Db, feedId: number, contests: ParsedContest[]) {
  await db.transaction(async (tx) => {
    for (const part of chunks(contests.map((c, i) => ({ c, i })))) {
      await tx
        .insert(resultContest)
        .values(
          part.map(({ c, i }) => ({
            feedId,
            sourceKey: c.sourceKey,
            name: c.name.slice(0, 300),
            group: c.group,
            voteFor: c.voteFor,
            precinctsTotal: c.precinctsTotal,
            precinctsReporting: c.precinctsReporting,
            totalVotes: c.candidates.reduce((n, x) => n + x.votes, 0),
            sort: i,
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            name: sql`values(${resultContest.name})`,
            group: sql`values(${resultContest.group})`,
            voteFor: sql`values(${resultContest.voteFor})`,
            precinctsTotal: sql`values(${resultContest.precinctsTotal})`,
            precinctsReporting: sql`values(${resultContest.precinctsReporting})`,
            totalVotes: sql`values(${resultContest.totalVotes})`,
            sort: sql`values(${resultContest.sort})`,
          },
        });
    }
    const stored = await tx
      .select({ id: resultContest.id, sourceKey: resultContest.sourceKey })
      .from(resultContest)
      .where(eq(resultContest.feedId, feedId));
    const ids = new Map(stored.map((r) => [r.sourceKey, r.id]));
    const gone = stored.filter((r) => !contests.some((c) => c.sourceKey === r.sourceKey));
    if (gone.length) {
      const goneIds = gone.map((r) => r.id);
      await tx.delete(resultArea).where(inArray(resultArea.contestId, goneIds));
      await tx.delete(resultCandidate).where(inArray(resultCandidate.contestId, goneIds));
      await tx.delete(resultContest).where(inArray(resultContest.id, goneIds));
    }

    const candidates = contests.flatMap((c) =>
      c.candidates.map((x) => ({
        contestId: ids.get(c.sourceKey)!,
        key: x.key,
        name: x.name.slice(0, 200),
        party: x.party?.slice(0, 60) ?? null,
        votes: x.votes,
      })),
    );
    for (const part of chunks(candidates)) {
      await tx
        .insert(resultCandidate)
        .values(part)
        .onDuplicateKeyUpdate({
          set: {
            name: sql`values(${resultCandidate.name})`,
            party: sql`values(${resultCandidate.party})`,
            votes: sql`values(${resultCandidate.votes})`,
          },
        });
    }
    const areas = contests.flatMap((c) =>
      c.areas.map((a) => ({
        contestId: ids.get(c.sourceKey)!,
        code: a.code.slice(0, 20),
        name: a.name.slice(0, 100),
        precinctsTotal: a.precinctsTotal,
        precinctsReporting: a.precinctsReporting,
        votes: a.votes,
      })),
    );
    for (const part of chunks(areas)) {
      await tx
        .insert(resultArea)
        .values(part)
        .onDuplicateKeyUpdate({
          set: {
            name: sql`values(${resultArea.name})`,
            precinctsTotal: sql`values(${resultArea.precinctsTotal})`,
            precinctsReporting: sql`values(${resultArea.precinctsReporting})`,
            votes: sql`values(${resultArea.votes})`,
          },
        });
    }
    // Candidates the state has withdrawn from a contest's listing.
    for (const c of contests) {
      const id = ids.get(c.sourceKey)!;
      const keys = c.candidates.map((x) => x.key);
      if (keys.length)
        await tx
          .delete(resultCandidate)
          .where(and(eq(resultCandidate.contestId, id), notInArray(resultCandidate.key, keys)));
    }
  });
}
