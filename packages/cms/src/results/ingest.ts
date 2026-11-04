import { createHash } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import { activeFeeds, type ResultFeedConfig } from './feeds';
import {
  addCaCountyAreas,
  addCountyAreas,
  parseCaSos,
  parseFlDos,
  parseMnSos,
  parseNcsbe,
  type ParsedContest,
} from './parse';
import { describeUpdates, type ContestSnapshot } from './updates';

const { ingestRun, resultArea, resultCandidate, resultContest, resultFeed, resultUpdate } = schema;

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
      // States serve these files through CDNs that ignore no-cache and keep handing out
      // an old copy (Florida's was hours stale on election night). A query string they
      // haven't seen gets the current file.
      const fresh = new URL(url);
      fresh.searchParams.set('_', String(Date.now()));
      const res = await doFetch(fresh.toString(), {
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
    // Extra files (a state that publishes one document per race) and per-county files
    // are read a few at a time. One that fails is skipped rather than failing the
    // state: its contest or county keeps its last numbers.
    const many = async <T extends { url: string }>(list: T[]) => {
      const out: (T & { body: string })[] = [];
      for (let i = 0; i < list.length; i += 10) {
        const got = await Promise.all(
          list.slice(i, i + 10).map(async (x) => {
            try {
              return { ...x, body: await fetchBody(x.url, doFetch) };
            } catch {
              return null;
            }
          }),
        );
        for (const g of got) if (g) out.push(g);
      }
      return out;
    };
    const parts = await many((f.parts ?? []).map((url) => ({ url })));
    const counties = f.counties
      ? await many(
          f.counties.names.map((name, i) => ({
            code: String(i + 1),
            name,
            url: f.counties!.url(i + 1, name),
          })),
        )
      : [];
    const hash = createHash('sha256')
      .update(body)
      .update(parts.map((c) => c.body).join('\n'))
      .update(counties.map((c) => c.body).join('\n'))
      .digest('hex');
    if (hash === feed.bodyHash) {
      await db
        .update(resultFeed)
        .set({ fetchedAt: new Date(), error: null })
        .where(eq(resultFeed.id, feed.id));
      return { ...base, outcome: 'unchanged' };
    }
    const contests = parseFeed(f, body, parts, counties);
    if (contests.length === 0) throw new Error('The file has no contests in it.');
    const before = await snapshot(db, feed.id);
    await storeContests(db, feed.id, contests);
    const now = new Date();
    const updates = describeUpdates(f.state, before, await snapshot(db, feed.id));
    if (updates.length) {
      await db
        .insert(resultUpdate)
        .values(updates.map((u) => ({ ...u, feedId: feed.id, createdAt: now })));
    }
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

/** Turns what was read into contests, by the state's format. */
export function parseFeed(
  f: ResultFeedConfig,
  body: string,
  parts: { url: string; body: string }[],
  counties: { code: string; name: string; body: string }[],
): ParsedContest[] {
  switch (f.kind) {
    case 'ncsbe':
      return addCountyAreas(parseNcsbe(body), counties);
    case 'fl-dos':
      return parseFlDos(body);
    case 'mn-sos':
      return parseMnSos([body]);
    case 'ca-sos': {
      const path = (url: string) => url.replace(/^.*\/returns\//, '');
      const contests = parseCaSos(
        [{ url: f.url, body }, ...parts].map((x) => ({ path: path(x.url), body: x.body })),
      );
      return f.counties?.race ? addCaCountyAreas(contests, f.counties.race, counties) : contests;
    }
  }
}

/** Each contest's numbers as stored, to compare a new read against. */
async function snapshot(db: Db, feedId: number): Promise<ContestSnapshot[]> {
  const contests = await db
    .select({
      id: resultContest.id,
      name: resultContest.name,
      group: resultContest.group,
      precinctsTotal: resultContest.precinctsTotal,
      precinctsReporting: resultContest.precinctsReporting,
      totalVotes: resultContest.totalVotes,
    })
    .from(resultContest)
    .where(eq(resultContest.feedId, feedId));
  if (contests.length === 0) return [];
  const candidates = await db
    .select({
      contestId: resultCandidate.contestId,
      name: resultCandidate.name,
      votes: resultCandidate.votes,
    })
    .from(resultCandidate)
    .innerJoin(resultContest, eq(resultContest.id, resultCandidate.contestId))
    .where(eq(resultContest.feedId, feedId));
  return contests.map((c) => ({
    ...c,
    candidates: candidates.filter((x) => x.contestId === c.id),
  }));
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
