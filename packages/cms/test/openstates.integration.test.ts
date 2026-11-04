import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  createElection,
  createPerson,
  getStateVotes,
  loadLegislatures,
  LEGISLATURES_2027,
  runOpenStatesImport,
  type Actor,
} from '../src/index';

/*
 * Made-up responses in the shape of the Open States v3 API. The names and IDs are not
 * real legislators; they only exercise the import.
 */
const PEOPLE = [
  // Same name as a VA candidate already in CivicScope: linked.
  { id: 'ocd-person/x-1', name: 'Pat Example', given_name: 'Pat', family_name: 'Example' },
  // Nobody by this name: becomes a draft person.
  {
    id: 'ocd-person/x-2',
    name: 'Robin Newname',
    given_name: 'Robin',
    family_name: 'Newname',
    openstates_url: 'https://openstates.org/person/robin-newname-x2/',
    current_role: { title: 'Senator', org_classification: 'upper', district: '9' },
  },
  // Same name as someone with no candidacy in VA: left for an editor.
  { id: 'ocd-person/x-3', name: 'Jamie Sample' },
  // Already has the ID.
  { id: 'ocd-person/x-4', name: 'Lee Linked' },
];

const vote = (id: string, date: string, positions: [string, string | null, string][]) => ({
  id,
  motion_text: 'Passage',
  start_date: date,
  result: 'pass',
  organization: { classification: 'lower' },
  votes: positions.map(([voter_name, osId, option]) => ({
    option,
    voter_name,
    voter: osId ? { id: osId, name: voter_name } : null,
  })),
  counts: [
    { option: 'yes', value: 60 },
    { option: 'no', value: 38 },
    { option: 'not voting', value: 2 },
  ],
  sources: [{ url: 'https://lis.example.gov/vote/1' }],
});

const bill = (n: number, updated: string, votes: unknown[]) => ({
  id: `ocd-bill/x-${n}`,
  session: '2026',
  identifier: `HB ${n}`,
  title: `A bill about item ${n}`,
  updated_at: updated,
  latest_action_date: '2026-03-01',
  latest_action_description: 'Signed by Governor',
  openstates_url: `https://openstates.org/va/bills/2026/HB${n}/`,
  votes,
});

const BILL_PAGES = [
  [
    bill(1, '2026-03-01T10:00:00+00:00', [
      vote('ocd-vote/x-1', '2026-02-10', [
        ['Example', 'ocd-person/x-1', 'yes'],
        ['Newname', 'ocd-person/x-2', 'no'],
        ['Smith', null, 'yes'],
      ]),
    ]),
    // No recorded votes: not stored.
    bill(2, '2026-03-02T10:00:00+00:00', []),
  ],
  [
    bill(3, '2026-03-05T10:00:00+00:00', [
      vote('ocd-vote/x-3', '2026-02-20', [['Example', 'ocd-person/x-1', 'not voting']]),
    ]),
  ],
];

const requests: { url: URL; key: string | null }[] = [];
const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  requests.push({ url, key: headers.get('x-api-key') });
  const page = Number(url.searchParams.get('page') ?? 1);
  let body: unknown;
  if (url.pathname === '/people') {
    body = { results: PEOPLE, pagination: { page: 1, max_page: 1, total_items: 4 } };
  } else if (url.pathname === '/bills') {
    body = {
      results: BILL_PAGES[page - 1] ?? [],
      pagination: { page, max_page: BILL_PAGES.length, total_items: 3 },
    };
  } else {
    return new Response('not found', { status: 404 });
  }
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

let test: TestDatabase;
let db: Db;
let editor: Actor;
let patId: number;

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
  const [someRace] = await db
    .select({ id: schema.race.id })
    .from(schema.race)
    .innerJoin(schema.office, eq(schema.office.id, schema.race.officeId))
    .where(eq(schema.office.jurisdictionId, va!.id))
    .limit(1);
  patId = await createPerson(db, editor, { fullName: 'Pat Example' });
  await db
    .insert(schema.candidacy)
    .values({ personId: patId, raceId: someRace!.id, ballotName: 'Pat Example' });
  await createPerson(db, editor, { fullName: 'Jamie Sample' });
  const lee = await createPerson(db, editor, { fullName: 'Lee Linked' });
  await addPersonIdentifier(db, editor, lee, { scheme: 'openstates', value: 'ocd-person/x-4' });
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

const run = (maxRequests: number) =>
  runOpenStatesImport(db, {
    apiKey: 'test-key',
    states: ['VA'],
    maxRequests,
    fetch: fakeFetch,
    sleep: async () => {},
    today: '2026-11-04',
  });

describe('runOpenStatesImport', () => {
  it('matches legislators, stops at the budget and continues on the next run', async () => {
    const first = await run(2);
    expect(first.summary).toMatchObject({
      requests: 2,
      created: 1,
      linked: 1,
      unchanged: 1,
      states: [{ state: 'VA', legislators: 4, billPages: 1, billsWithVotes: 1, caughtUp: false }],
    });
    expect(first.summary.attention).toEqual([
      expect.objectContaining({ openstatesId: 'ocd-person/x-3', name: 'Jamie Sample' }),
    ]);
    // The key travels in a header, never in a stored URL.
    expect(requests.every((r) => r.key === 'test-key' && !r.url.search.includes('test'))).toBe(
      true,
    );
    const [cursor] = await db.select().from(schema.stateVoteCursor);
    expect(cursor).toMatchObject({ state: 'VA', page: 2 });

    const second = await run(10);
    expect(second.summary).toMatchObject({
      created: 0,
      linked: 0,
      unchanged: 3,
      states: [{ billPages: 1, billsWithVotes: 1, caughtUp: true }],
    });
    const [after] = await db.select().from(schema.stateVoteCursor);
    expect(after).toEqual({ state: 'VA', updatedSince: '2026-03-05T10:00:00+00:00', page: 1 });
    expect(requests.at(-1)!.url.searchParams.get('sort')).toBe('updated_asc');

    const bills = await db.select().from(schema.stateBill);
    expect(bills.map((b) => b.identifier).sort()).toEqual(['HB 1', 'HB 3']);
    const [v] = await db
      .select()
      .from(schema.stateVote)
      .where(eq(schema.stateVote.osId, 'ocd-vote/x-1'));
    expect(v).toMatchObject({ chamber: 'lower', yes: 60, no: 38, other: 2, votedOn: '2026-02-10' });
    const positions = await db
      .select()
      .from(schema.stateVotePosition)
      .where(eq(schema.stateVotePosition.voteId, v!.id));
    expect(positions).toHaveLength(3);
    expect(positions.find((p) => p.voterName === 'Smith')?.osPersonId).toBeNull();
  });

  it('creates drafts with a citation, and shows a person their votes newest first', async () => {
    const [robin] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.fullName, 'Robin Newname'));
    expect(robin).toMatchObject({ sortName: 'Newname, Robin', publishState: 'draft' });
    const cites = await db
      .select()
      .from(schema.citation)
      .where(
        and(eq(schema.citation.subjectType, 'person'), eq(schema.citation.subjectId, robin!.id)),
      );
    expect(cites).toHaveLength(1);

    const pat = await getStateVotes(db, patId);
    expect(pat.total).toBe(2);
    expect(pat.votes.map((v) => [v.bill.identifier, v.option])).toEqual([
      ['HB 3', 'not voting'],
      ['HB 1', 'yes'],
    ]);
    // Reading the same bills again replaces, never duplicates, the votes.
    await db.delete(schema.stateVoteCursor);
    await run(10);
    expect((await getStateVotes(db, patId)).total).toBe(2);
  });
});
