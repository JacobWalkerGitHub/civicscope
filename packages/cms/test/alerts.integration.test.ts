import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import { findIngestProblems } from '../src/index';

let test: TestDatabase;
let db: Db;
const now = new Date('2026-11-03T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await db.insert(schema.ingestRun).values([
    // Failed an hour ago: reported.
    {
      source: 'fec',
      params: {},
      state: 'failed',
      startedAt: hoursAgo(1.5),
      finishedAt: hoursAgo(1),
      error: 'HTTP 503',
    },
    // Failed yesterday: already reported by an earlier check.
    {
      source: 'fec',
      params: {},
      state: 'failed',
      startedAt: hoursAgo(30),
      finishedAt: hoursAgo(29),
    },
    // Still "running" after 8 hours: stuck.
    { source: 'congress_gov', params: {}, state: 'running', startedAt: hoursAgo(8) },
    // Running for an hour: fine.
    { source: 'congress_gov', params: {}, state: 'running', startedAt: hoursAgo(1) },
    {
      source: 'fec',
      params: {},
      state: 'succeeded',
      startedAt: hoursAgo(1),
      finishedAt: hoursAgo(0.5),
    },
  ]);
});
afterAll(async () => {
  await test?.stop();
});

describe('findIngestProblems', () => {
  it('finds recent failures and stuck runs, nothing else', async () => {
    const problems = await findIngestProblems(db, { since: hoursAgo(2), now, stuckAfterHours: 6 });
    expect(problems.map((p) => [p.kind, p.source, p.error])).toEqual([
      ['failed', 'fec', 'HTTP 503'],
      ['stuck', 'congress_gov', null],
    ]);
  });
});
