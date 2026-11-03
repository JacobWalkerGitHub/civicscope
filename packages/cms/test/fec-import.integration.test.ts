import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  createParty,
  createPerson,
  getIngestRun,
  listIngestRuns,
  lockField,
  runFecImport,
  type Actor,
} from '../src/index';

/*
 * Made-up records in the shape of OpenFEC /v1/candidates/ results. These are not real
 * candidates or FEC IDs; they only exercise the import.
 */
type Rec = Record<string, unknown>;
const rec = (over: Rec): Rec => ({
  party: 'EXP',
  incumbent_challenge: 'C',
  candidate_status: 'C',
  candidate_inactive: false,
  first_file_date: '2026-03-02',
  election_years: [2028],
  district: '00',
  ...over,
});
const FIXTURE: Rec[] = [
  rec({ candidate_id: 'P80000901', name: 'PRESIDENTIAL, PAT', office: 'P', state: 'US' }),
  rec({ candidate_id: 'S8KY00901', name: 'SENATOR, SAM Q', office: 'S', state: 'KY' }),
  rec({
    candidate_id: 'S8KY00902',
    name: 'MCEXAMPLE, MORGAN JR',
    office: 'S',
    state: 'KY',
    party: 'ZZZ',
    incumbent_challenge: 'I',
  }),
  rec({
    candidate_id: 'H8KY06901',
    name: 'HOUSE, HARPER',
    office: 'H',
    state: 'KY',
    district: '06',
  }),
  rec({
    candidate_id: 'H8AK00901',
    name: 'ATLARGE, ALEX',
    office: 'H',
    state: 'AK',
    district: '00',
  }),
  rec({
    candidate_id: 'H8GU00901',
    name: 'TERRITORY, TERRY',
    office: 'H',
    state: 'GU',
    district: '00',
  }),
  rec({
    candidate_id: 'H8KY06902',
    name: 'INACTIVE, IVY',
    office: 'H',
    state: 'KY',
    district: '06',
    candidate_inactive: true,
  }),
  rec({
    candidate_id: 'H8KY06903',
    name: 'SAMPLE, JAMIE',
    office: 'H',
    state: 'KY',
    district: '06',
  }),
  // The live 2028 data listed a Maryland senator's registration under DC.
  rec({ candidate_id: 'S8MD00901', name: 'MISFILED, MAX', office: 'S', state: 'DC' }),
  rec({ candidate_id: 'S8DC00901', name: 'CAPITAL, CASEY', office: 'S', state: 'DC' }),
];

let test: TestDatabase;
let db: Db;
let editor: Actor;
let records: Rec[] = FIXTURE;
const requested: string[] = [];

/** Serves `records` two per page, like the FEC's paginated API. */
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  requested.push(url.toString());
  const page = Number(url.searchParams.get('page'));
  const per = 2;
  const pages = Math.ceil(records.length / per);
  const body = {
    api_version: '1.0',
    results: records.slice((page - 1) * per, page * per),
    pagination: { page, pages, count: records.length, per_page: per },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const run = (fetchImpl: typeof fetch = fakeFetch) =>
  runFecImport(db, 2028, {
    apiKey: 'test-key-123',
    fetch: fetchImpl,
    sleep: async () => {},
    today: '2026-11-02',
  });

async function candidacyFor(fecId: string) {
  const [row] = await db
    .select({ candidacy: schema.candidacy, person: schema.person, race: schema.race })
    .from(schema.personIdentifier)
    .innerJoin(schema.person, eq(schema.person.id, schema.personIdentifier.personId))
    .innerJoin(schema.candidacy, eq(schema.candidacy.personId, schema.person.id))
    .innerJoin(schema.race, eq(schema.race.id, schema.candidacy.raceId))
    .where(
      and(
        eq(schema.personIdentifier.scheme, 'fec_candidate_id'),
        eq(schema.personIdentifier.value, fecId),
      ),
    );
  return row;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [res] = await db.insert(schema.adminUser).values({
    email: 'editor@test.local',
    name: 'Editor',
    passwordHash: 'x',
    role: 'owner',
  });
  editor = { userId: res.insertId, ipAddress: '10.0.0.5' };
  await createParty(db, editor, { name: 'Example Party', fecCode: 'EXP' });
  // Someone already in CivicScope, entered by hand, with no FEC ID.
  await createPerson(db, editor, { fullName: 'Jamie Sample' });
});
afterAll(async () => {
  await test?.stop();
});

describe('FEC import', () => {
  it('creates draft races, people and candidacies from registrations', async () => {
    const { summary, runId } = await run();
    expect(summary.fetched).toBe(10);
    expect(summary.skippedInactive).toBe(1);
    expect(summary.counts.create).toBe(5);
    expect(summary.unknownPartyCodes).toEqual(['ZZZ']);

    const president = await candidacyFor('P80000901');
    expect(president?.race.name).toBe('President of the United States');
    expect(president?.person).toMatchObject({
      fullName: 'Pat Presidential',
      publishState: 'draft',
    });
    expect(president?.candidacy).toMatchObject({
      status: 'registered',
      statusDate: '2026-03-02',
      publishState: 'draft',
    });

    const senator = await candidacyFor('S8KY00902');
    expect(senator?.race.name).toBe('U.S. Senate, Kentucky');
    expect(senator?.person).toMatchObject({
      fullName: 'Morgan McExample Jr.',
      sortName: 'McExample Jr., Morgan',
    });
    expect(senator?.candidacy).toMatchObject({ isIncumbent: true, partyId: null });

    const house = await candidacyFor('H8KY06901');
    expect(house?.race.name).toBe('U.S. House, Kentucky District 6');
    expect(house?.race.publishState).toBe('draft');
    const [d] = await db
      .select()
      .from(schema.district)
      .where(eq(schema.district.id, house!.race.districtId!));
    expect(d).toMatchObject({ ocdId: 'ocd-division/country:us/state:ky/cd:6', label: '6' });
    expect((await candidacyFor('H8AK00901'))?.race).toMatchObject({
      name: 'U.S. House, Alaska At-Large',
      districtId: null,
    });

    // Every imported candidacy is cited to the public FEC list for its race.
    const cites = await db
      .select({ url: schema.source.url, type: schema.source.sourceType })
      .from(schema.citation)
      .innerJoin(schema.source, eq(schema.source.id, schema.citation.sourceId))
      .where(
        and(
          eq(schema.citation.subjectType, 'candidacy'),
          eq(schema.citation.subjectId, house!.candidacy.id),
        ),
      );
    expect(cites[0]).toMatchObject({
      url: 'https://www.fec.gov/data/candidates/house/?election_year=2028&state=KY&district=06',
      type: 'government_record',
    });

    // Never guessed: a territory, a possible duplicate, a registration whose state
    // disagrees with its ID, and a Senate seat D.C. doesn't have all wait for a person.
    for (const id of ['H8GU00901', 'H8KY06903', 'S8MD00901', 'S8DC00901']) {
      expect(await candidacyFor(id)).toBeUndefined();
    }
    expect(summary.attention.map((a) => [a.fecId, a.problem])).toEqual([
      ['S8MD00901', expect.stringContaining('issued for MD')],
      ['H8GU00901', expect.stringContaining('territories')],
      ['H8KY06903', expect.stringContaining('Possible duplicate of Jamie Sample')],
      ['S8DC00901', expect.stringContaining('no U.S. Senate or voting House seat')],
    ]);
    const races = await db.select({ name: schema.race.name }).from(schema.race);
    expect(races.map((r) => r.name)).not.toContain('U.S. Senate, District of Columbia');

    // The raw pages are kept, without the API key.
    const detail = await getIngestRun(db, runId);
    expect(detail?.run.state).toBe('succeeded');
    expect(detail?.pages).toBe(5);
    const snaps = await db.select().from(schema.ingestSnapshot);
    expect(snaps.every((s) => !s.url.includes('test-key-123'))).toBe(true);
    expect(requested[0]).toContain('candidate_status=C');
  });

  it('changes nothing when run again on the same data', async () => {
    const batchesBefore = (await db.select().from(schema.importBatch)).length;
    const revisionsBefore = (await db.select().from(schema.revision)).length;
    const { summary } = await run();
    expect(summary.counts).toMatchObject({ create: 0, add_to_race: 0, update: 0, unchanged: 5 });
    expect(summary.racesChanged).toBe(0);
    expect((await db.select().from(schema.importBatch)).length).toBe(batchesBefore);
    expect((await db.select().from(schema.revision)).length).toBe(revisionsBefore);
  });

  it('leaves a field an editor locked alone, and opens a conflict instead', async () => {
    const house = (await candidacyFor('H8KY06901'))!;
    await db.transaction((tx) =>
      lockField(tx, editor, 'candidacy', house.candidacy.id, 'isIncumbent', 'Checked by hand'),
    );
    records = FIXTURE.map((r) =>
      r.candidate_id === 'H8KY06901' ? { ...r, incumbent_challenge: 'I' } : r,
    );
    const { summary } = await run();
    expect(summary.counts.conflicts).toBe(1);
    expect((await candidacyFor('H8KY06901'))!.candidacy.isIncumbent).toBe(false);
    const open = await db
      .select()
      .from(schema.reviewItem)
      .where(eq(schema.reviewItem.state, 'open'));
    expect(open).toEqual([
      expect.objectContaining({
        entityId: house.candidacy.id,
        field: 'isIncumbent',
        proposedValue: true,
      }),
    ]);
    // And it doesn't open a second conflict for the same thing next time.
    expect((await run()).summary.counts.conflicts).toBe(0);
    records = FIXTURE;
  });

  it('retries rate limits, and fails loudly on data in an unexpected format', async () => {
    let calls = 0;
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls === 1) return new Response('slow down', { status: 429 });
      return fakeFetch(input, init);
    }) as typeof fetch;
    expect((await run(flaky)).summary.counts.unchanged).toBe(5);

    records = [{ candidate_id: 'nope', name: 'BROKEN' }];
    await expect(run()).rejects.toThrow(/not in the expected format/);
    const [latest] = await listIngestRuns(db, 1);
    expect(latest).toMatchObject({ state: 'failed' });
    expect(latest!.error).toMatch(/expected format/);
    records = FIXTURE;
  });

  it('acts as an automated account that cannot sign in', async () => {
    const [bot] = await db
      .select()
      .from(schema.adminUser)
      .where(eq(schema.adminUser.name, 'Automated import (FEC)'));
    expect(bot?.disabledAt).toBeInstanceOf(Date);
    expect(bot?.passwordHash).toBe('!');
  });
});
