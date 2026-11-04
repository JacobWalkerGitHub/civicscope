import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  getContestResults,
  getStateResults,
  listResultDates,
  listResultStates,
  runResultsIngest,
  type ResultFeedConfig,
} from '../src/index';

let test: TestDatabase;
let db: Db;

const FEED: ResultFeedConfig = {
  state: 'FL',
  electionDate: '2026-11-03',
  kind: 'fl-dos',
  url: 'https://example.test/fl.txt',
  publicUrl: 'https://example.test/',
};
const HEADER =
  'ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes';
const row = (
  code: string,
  name: string,
  county: string,
  last: string,
  rep: number,
  votes: number,
) =>
  `11/03/2026\tNPA\tNo Party\t${code}\t${name}\t${county.slice(0, 3).toUpperCase()}\t${county}\t\t\t10\t${rep}\t${last}\tA\t\t${votes}`;

let body = '';
const fakeFetch = (async () => new Response(body)) as unknown as typeof fetch;
const failingFetch = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

describe('live results', () => {
  it('stores a read, skips an unchanged file and replaces numbers when it changes', async () => {
    body = [
      HEADER,
      row('GOV', 'Governor', 'Alachua', 'Bee', 0, 0),
      row('GOV', 'Governor', 'Alachua', 'Cee', 0, 0),
      row('GOV', 'Governor', 'Baker', 'Bee', 0, 0),
      row('GOV', 'Governor', 'Baker', 'Cee', 0, 0),
      row('XYZ', 'Old District', 'Baker', 'Dee', 0, 0),
    ].join('\n');
    const first = await runResultsIngest(db, { feeds: [FEED], fetch: fakeFetch });
    expect(first.feeds).toEqual([
      { state: 'FL', electionDate: '2026-11-03', outcome: 'changed', contests: 2 },
    ]);
    const again = await runResultsIngest(db, { feeds: [FEED], fetch: fakeFetch });
    expect(again.feeds[0]!.outcome).toBe('unchanged');

    const before = await getStateResults(db, 'fl', '2026-11-03');
    const govId = before!.contests.find((c) => c.name === 'Governor')!.id;

    body = [
      HEADER,
      row('GOV', 'Governor', 'Alachua', 'Bee', 4, 30),
      row('GOV', 'Governor', 'Alachua', 'Cee', 4, 50),
      row('GOV', 'Governor', 'Baker', 'Bee', 10, 25),
      row('GOV', 'Governor', 'Baker', 'Cee', 10, 5),
    ].join('\n');
    await runResultsIngest(db, { feeds: [FEED], fetch: fakeFetch });

    const page = await getStateResults(db, 'FL', '2026-11-03');
    expect(page!.summary).toMatchObject({ stateName: 'Florida', contests: 1, error: null });
    const gov = page!.contests[0]!;
    // The contest keeps its ID, so links to it keep working.
    expect(gov.id).toBe(govId);
    expect(gov).toMatchObject({ precinctsTotal: 20, precinctsReporting: 14, totalVotes: 110 });
    // A tie falls back to alphabetical order.
    expect(gov.candidates.map((c) => [c.name, c.votes])).toEqual([
      ['A Bee', 55],
      ['A Cee', 55],
    ]);
    expect(gov.hasAreas).toBe(true);

    const detail = await getContestResults(db, govId);
    expect(detail!.areas.map((a) => [a.name, a.precinctsReporting])).toEqual([
      ['Alachua', 4],
      ['Baker', 10],
    ]);
    // The contest the state dropped is gone, with its candidates.
    const [left] = await db.select({ n: count() }).from(schema.resultCandidate);
    expect(left!.n).toBe(2);

    expect(await listResultDates(db)).toEqual(['2026-11-03']);
    const [state] = await listResultStates(db, '2026-11-03');
    expect(state!.headline).toMatchObject({ name: 'Governor', precinctsReporting: 14 });
  });

  it('keeps the last numbers and records the error when a read fails', async () => {
    const run = await runResultsIngest(db, { feeds: [FEED], fetch: failingFetch });
    expect(run.feeds[0]!.outcome).toBe('failed');
    const [ingest] = await db
      .select()
      .from(schema.ingestRun)
      .where(eq(schema.ingestRun.id, run.runId!));
    expect(ingest!.state).toBe('failed');
    const page = await getStateResults(db, 'FL', '2026-11-03');
    expect(page!.summary.error).toMatch(/HTTP 404/);
    expect(page!.contests[0]!.totalVotes).toBe(110);
  });

  it('does nothing when no file is live', async () => {
    const run = await runResultsIngest(db, { now: new Date('2027-03-01T00:00:00Z') });
    expect(run).toEqual({ runId: null, feeds: [] });
  });
});
