import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  createPerson,
  getStateOfficial,
  listStateOfficials,
  runStateOfficialsImport,
  stateOfficialsCoverage,
  type Actor,
} from '../src/index';

/*
 * Made-up files in the shape of Open States' public data. The names and IDs are not real
 * officeholders; they only exercise the import.
 */
const HEADER =
  'id,name,current_party,current_district,current_chamber,given_name,family_name,links,sources';
const leg = (n: number, chamber: string, party = 'Democratic') =>
  `ocd-person/l-${n},Legislator ${n},${party},${n},${chamber},Legislator,Number${n},https://house.example.gov/${n},`;

let vaCsv = [HEADER, leg(1, 'upper'), leg(2, 'lower'), leg(3, 'lower', 'Republican')].join('\n');
let njCsv: string | null = [HEADER, leg(10, 'upper'), leg(11, 'lower')].join('\n');

const governor = (id: string, name: string, state: string, start: string, end: string) => `id: ${id}
name: ${name}
party:
- name: Republican
roles:
- start_date: '${start}'
  end_date: '${end}'
  type: governor
  jurisdiction: ocd-jurisdiction/country:us/state:${state}/government
links:
- url: https://www.governor.${state}.example.gov/
`;

const files: Record<string, string> = {
  'data/va/executive/Gov-A.yml': governor(
    'ocd-person/g-va',
    'Gov Virginia',
    'va',
    '2026-01-17',
    '2030-01-17',
  ),
  'data/va/executive/Old-Gov.yml': governor(
    'ocd-person/g-old',
    'Old Gov',
    'va',
    '2022-01-15',
    '2026-01-17',
  ),
  'data/nj/executive/Gov-B.yml': governor(
    'ocd-person/g-nj',
    'Gov Jersey',
    'nj',
    '2026-01-20',
    '2030-01-21',
  ),
  'data/nj/executive/Gov-C.yml': governor(
    'ocd-person/g-nj2',
    'Gov Two',
    'nj',
    '2026-01-20',
    '2030-01-21',
  ),
};

const fakeFetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.github.com') {
    return Response.json({
      sha: 'abc123',
      truncated: false,
      tree: [
        { path: 'data/va', type: 'tree' },
        ...Object.keys(files).map((path) => ({ path, type: 'blob' })),
        { path: 'data/va/legislature/Someone.yml', type: 'blob' },
      ],
    });
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    const path = url.pathname.replace('/openstates/people/abc123/', '');
    return files[path] ? new Response(files[path]) : new Response('missing', { status: 404 });
  }
  if (url.pathname === '/people/current/va.csv') return new Response(vaCsv);
  if (url.pathname === '/people/current/nj.csv' && njCsv) return new Response(njCsv);
  return new Response('not found', { status: 404 });
}) as typeof fetch;

let test: TestDatabase;
let db: Db;
let editor: Actor;

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email: 'editor@test.local', name: 'Editor', passwordHash: 'x', role: 'owner' });
  editor = { userId: res.insertId, ipAddress: null };
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

const run = (today: string) =>
  runStateOfficialsImport(db, {
    states: ['VA', 'NJ'],
    fetch: fakeFetch,
    sleep: async () => {},
    today,
  });

describe('runStateOfficialsImport', () => {
  it('imports governors and legislators, and flags what it cannot trust', async () => {
    const { summary } = await run('2026-11-01');
    expect(summary.states).toEqual([
      expect.objectContaining({
        state: 'VA',
        governor: 'Gov Virginia',
        legislators: 3,
        added: 4,
        refreshed: true,
      }),
      // Two governors in office at once: neither is taken.
      expect.objectContaining({
        state: 'NJ',
        governor: null,
        legislators: 2,
        added: 2,
        refreshed: false,
      }),
    ]);
    expect(summary.attention).toEqual([
      { state: 'NJ', problem: expect.stringMatching(/lists 2 governors/) },
    ]);
    const va = await db
      .select()
      .from(schema.stateOfficeholder)
      .where(eq(schema.stateOfficeholder.state, 'VA'));
    expect(va.find((r) => r.role === 'governor')).toMatchObject({
      osPersonId: 'ocd-person/g-va',
      termStart: '2026-01-17',
      termEnd: '2030-01-17',
      officialUrl: 'https://www.governor.va.example.gov/',
      firstSeenOn: '2026-11-01',
      lastSeenOn: '2026-11-01',
      leftOn: null,
    });
    // Every row cites the file it came from.
    const [src] = await db
      .select()
      .from(schema.source)
      .where(eq(schema.source.id, va.find((r) => r.role === 'upper')!.sourceId));
    expect(src).toMatchObject({
      url: 'https://data.openstates.org/people/current/va.csv',
      publisher: 'Open States',
      retrievedAt: '2026-11-01',
    });
  });

  it('marks changes and departures, and keeps a state whose file goes missing', async () => {
    // Legislator 3 changes party, 2 leaves, 4 arrives; NJ's file is gone.
    vaCsv = [HEADER, leg(1, 'upper'), leg(3, 'lower', 'Independent'), leg(4, 'lower')].join('\n');
    njCsv = null;
    delete files['data/nj/executive/Gov-C.yml'];
    const snapshotsBefore = (await db.select().from(schema.ingestSnapshot)).length;
    const { summary } = await run('2026-11-02');
    expect(summary.states[0]).toMatchObject({ added: 1, updated: 1, left: 1, refreshed: true });
    expect(summary.states[1]).toMatchObject({ governor: 'Gov Jersey', added: 1, refreshed: false });
    expect(summary.attention).toEqual([
      { state: 'NJ', problem: expect.stringMatching(/Legislators were not read/) },
    ]);
    const rows = await db.select().from(schema.stateOfficeholder);
    const by = (id: string) => rows.find((r) => r.osPersonId === id)!;
    expect(by('ocd-person/l-2')).toMatchObject({ leftOn: '2026-11-02', lastSeenOn: '2026-11-01' });
    expect(by('ocd-person/l-3')).toMatchObject({
      partyName: 'Independent',
      lastSeenOn: '2026-11-02',
    });
    expect(by('ocd-person/l-1')).toMatchObject({
      firstSeenOn: '2026-11-01',
      lastSeenOn: '2026-11-02',
    });
    // NJ legislators are kept as they were.
    expect(by('ocd-person/l-10')).toMatchObject({ leftOn: null, lastSeenOn: '2026-11-01' });
    // Unchanged files are not stored again: only the new VA list was.
    const snapshots = await db.select().from(schema.ingestSnapshot);
    expect(snapshots.length - snapshotsBefore).toBe(1);
  });

  it('refuses a list far shorter than the one it would replace', async () => {
    vaCsv = [HEADER, leg(1, 'upper')].join('\n');
    const { summary } = await run('2026-11-03');
    expect(summary.attention).toContainEqual({
      state: 'VA',
      problem: expect.stringMatching(/lists 1 legislators, against 3/),
    });
    const listed = await listStateOfficials(db, { state: 'VA' });
    expect(listed.rows.map((r) => r.osPersonId).sort()).toEqual([
      'ocd-person/g-va',
      'ocd-person/l-1',
      'ocd-person/l-3',
      'ocd-person/l-4',
    ]);
  });
});

describe('public reads', () => {
  it('lists governors by default, legislators by state or name', async () => {
    const all = await listStateOfficials(db);
    expect(all.governorsOnly).toBe(true);
    expect(all.rows.map((r) => r.name)).toEqual(['Gov Jersey', 'Gov Virginia']);
    const named = await listStateOfficials(db, { q: 'Number4' });
    expect(named.rows.map((r) => r.osPersonId)).toEqual(['ocd-person/l-4']);
    expect((await listStateOfficials(db, { state: 'va', role: 'lower' })).rows).toHaveLength(2);
  });

  it('reports coverage per state', async () => {
    const coverage = await stateOfficialsCoverage(db);
    expect(coverage.find((c) => c.state === 'VA')).toEqual({
      state: 'VA',
      governor: 1,
      legislators: 3,
      verifiedOn: '2026-11-02',
    });
    expect(coverage.find((c) => c.state === 'TX')).toMatchObject({ governor: 0, legislators: 0 });
  });

  it('links a published profile carrying the Open States ID', async () => {
    const id = await createPerson(db, editor, { fullName: 'Legislator 1' });
    await addPersonIdentifier(db, editor, id, { scheme: 'openstates', value: 'ocd-person/l-1' });
    expect((await getStateOfficial(db, 'ocd-person/l-1'))?.personSlug).toBeNull();
    await db
      .update(schema.person)
      .set({ publishState: 'published' })
      .where(eq(schema.person.id, id));
    const page = await getStateOfficial(db, 'ocd-person/l-1');
    expect(page?.personSlug).toMatch(/^legislator-1/);
    expect(page?.photoId).toBeNull();
    // The profile's photo shows on the official's cards and page too.
    await db.update(schema.person).set({ photoId: 4242 }).where(eq(schema.person.id, id));
    expect((await getStateOfficial(db, 'ocd-person/l-1'))?.photoId).toBe(4242);
    const listed = await listStateOfficials(db, { state: 'VA' });
    expect(listed.rows.find((r) => r.osPersonId === 'ocd-person/l-1')?.photoId).toBe(4242);
    await db.update(schema.person).set({ photoId: null }).where(eq(schema.person.id, id));
    expect(page?.offices[0]).toMatchObject({ role: 'upper', district: '1' });
    expect(await getStateOfficial(db, 'ocd-person/l-2')).toMatchObject({
      offices: [expect.objectContaining({ leftOn: '2026-11-02' })],
    });
  });
});
