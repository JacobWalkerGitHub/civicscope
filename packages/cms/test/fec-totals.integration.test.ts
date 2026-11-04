import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  createElection,
  createPerson,
  getFecTotals,
  loadLegislatures,
  LEGISLATURES_2027,
  runFecTotalsImport,
  type Actor,
} from '../src/index';

/* Made-up totals in the shape of the FEC's /v1/candidates/totals/. */
const TOTALS: Record<string, Record<string, unknown>> = {
  H6KY06999: {
    candidate_id: 'H6KY06999',
    cycle: 2026,
    receipts: 1250000.5,
    disbursements: 980000,
    cash_on_hand_end_period: 310250.25,
    debts_owed_by_committee: 0,
    coverage_start_date: '2025-01-01T00:00:00',
    coverage_end_date: '2026-10-14T00:00:00',
    load_date: '2026-10-20T03:11:00',
  },
};

const requested: URL[] = [];
const fakeFetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  requested.push(url);
  const ids = url.searchParams.getAll('candidate_id');
  const cycle = Number(url.searchParams.get('cycle'));
  const results = ids.map((id) => TOTALS[id]).filter((r) => r && r.cycle === cycle);
  return new Response(JSON.stringify({ results, pagination: { pages: 1 } }), { status: 200 });
}) as typeof fetch;

let test: TestDatabase;
let db: Db;
let editor: Actor;
let harper: number;

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email: 'editor@test.local', name: 'Editor', passwordHash: 'x', role: 'owner' });
  editor = { userId: res.insertId, ipAddress: null };
  const [va] = await db
    .select({ id: schema.jurisdiction.id })
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'VA'));
  await createElection(db, editor, {
    jurisdictionId: String(va!.id),
    type: 'primary',
    primarySystem: 'open_partisan',
    date: '2027-06-15',
    name: 'Example VA primary',
  });
  await loadLegislatures(db, editor, LEGISLATURES_2027);
  const [someRace] = await db.select({ id: schema.race.id }).from(schema.race).limit(1);
  harper = await createPerson(db, editor, { fullName: 'Harper House' });
  await addPersonIdentifier(db, editor, harper, { scheme: 'fec_candidate_id', value: 'H6KY06999' });
  await db
    .insert(schema.candidacy)
    .values({ personId: harper, raceId: someRace!.id, ballotName: 'Harper House' });
  // Running, but nothing filed for the period.
  const quiet = await createPerson(db, editor, { fullName: 'Quinn Quiet' });
  await addPersonIdentifier(db, editor, quiet, { scheme: 'fec_candidate_id', value: 'S6VA00999' });
  await db
    .insert(schema.candidacy)
    .values({ personId: quiet, raceId: someRace!.id, ballotName: 'Quinn Quiet' });
  // Has an FEC ID but runs in no race here: not read.
  const other = await createPerson(db, editor, { fullName: 'Not Running' });
  await addPersonIdentifier(db, editor, other, { scheme: 'fec_candidate_id', value: 'H0CA01999' });
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

describe('runFecTotalsImport', () => {
  it('stores the period totals for people in races, and shows them on the person', async () => {
    const { summary } = await runFecTotalsImport(db, 2026, {
      apiKey: 'test-key',
      fetch: fakeFetch,
      sleep: async () => {},
    });
    expect(summary).toEqual({ candidateIds: 2, requests: 1, stored: 1, missing: 1 });
    expect(requested[0]!.searchParams.getAll('candidate_id')).toEqual(['H6KY06999', 'S6VA00999']);
    expect(requested[0]!.searchParams.get('election_full')).toBe('false');
    const [snap] = await db.select().from(schema.ingestSnapshot);
    expect(snap!.url).not.toContain('test-key');

    expect(await getFecTotals(db, harper)).toEqual([
      {
        candidateId: 'H6KY06999',
        cycle: 2026,
        receipts: 1250000.5,
        disbursements: 980000,
        cashOnHand: 310250.25,
        debts: 0,
        coverageStart: '2025-01-01',
        coverageEnd: '2026-10-14',
      },
    ]);

    // A later read replaces the numbers instead of adding a row.
    TOTALS.H6KY06999!.receipts = 1300000;
    await runFecTotalsImport(db, 2026, { apiKey: 'k', fetch: fakeFetch, sleep: async () => {} });
    const rows = await db.select().from(schema.fecCandidateTotals);
    expect(rows).toHaveLength(1);
    expect((await getFecTotals(db, harper))[0]!.receipts).toBe(1300000);
  });
});
