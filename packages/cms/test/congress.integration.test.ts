import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  createPerson,
  getCongressRecord,
  listIngestRuns,
  runCongressImport,
  runLegislatorCrosswalk,
  type Actor,
} from '../src/index';

/*
 * Made-up records in the shapes of congress-legislators and the Congress.gov API.
 * The names and IDs are not real members of Congress; they only exercise the import.
 */
type Rec = Record<string, unknown>;
const legislator = (
  bioguide: string,
  first: string,
  last: string,
  fec: string[],
  terms: Rec[],
  extra: Rec = {},
): Rec => ({
  id: { bioguide, fec, wikidata: `Q9${bioguide.slice(1)}` },
  name: { first, last, ...extra },
  terms,
});
const rep = (state: string, district: number, start = '2025-01-03', end = '2027-01-03') => ({
  type: 'rep',
  start,
  end,
  state,
  district,
  party: 'Independent',
});

const CURRENT: Rec[] = [
  // Already in CivicScope through the FEC import (matched by FEC ID).
  legislator('X000001', 'Harper', 'House', ['H8KY06901'], [rep('KY', 6)]),
  // Nobody has any of these IDs: becomes a new draft person.
  legislator('X000002', 'Robin', 'Newmember', ['H4OH03999'], [rep('OH', 3)], {
    official_full: 'Robin A. Newmember',
  }),
  // Same name as a person entered by hand without IDs: a possible duplicate.
  legislator('X000003', 'Jamie', 'Sample', ['H6KY04999'], [rep('KY', 4)]),
  // FEC ID and Bioguide ID belong to two different people.
  legislator('X000004', 'Casey', 'Conflict', ['H2TX01999'], [rep('TX', 1)]),
];
const HISTORICAL: Rec[] = [
  // Left during the 119th Congress: in scope.
  legislator('X000005', 'Morgan', 'Former', [], [rep('NY', 21, '2023-01-03', '2025-04-01')]),
  // Left long ago: out of scope.
  legislator('X000006', 'Old', 'Timer', ['H0CA01999'], [rep('CA', 1, '1991-01-03', '1993-01-03')]),
];

const member = (bioguideId: string, name: string, state: string, district: number | null) => ({
  bioguideId,
  name,
  state,
  district,
  partyName: 'Independent',
  terms: { item: [{ chamber: 'House of Representatives', startYear: 2025 }] },
  updateDate: '2026-10-01T00:00:00Z',
});
const MEMBERS = [
  member('X000001', 'House, Harper', 'Kentucky', 6),
  member('X000002', 'Newmember, Robin A.', 'Ohio', 3),
  member('X000099', 'Unknown, Una', 'Guam', 0),
  member('X000004', 'Conflict, Casey', 'Atlantis', 1),
];

let BILL_UPDATED = '2026-10-02T00:00:00Z';
const BILLS = () => [
  {
    congress: 119,
    type: 'HR',
    number: '101',
    title: 'Example Act',
    // Like Congress.gov, the list gives only the date; the detail gives the timestamp.
    updateDate: BILL_UPDATED.slice(0, 10),
    latestAction: { actionDate: '2026-02-01', text: 'Referred to committee.' },
  },
];
let COSPONSORS: Rec[] = [
  {
    bioguideId: 'X000002',
    fullName: 'Rep. Newmember, Robin A. [I-OH-3]',
    party: 'I',
    state: 'OH',
    isOriginalCosponsor: true,
    sponsorshipDate: '2026-01-15',
  },
];

let VOTE_UPDATED = '2026-10-03T00:00:00Z';
const voteMembers = (roll: number, session: number) => ({
  houseRollCallVoteMemberVotes: {
    congress: 119,
    sessionNumber: session,
    rollCallNumber: roll,
    startDate: session === 1 ? '2025-09-08T18:56:00-04:00' : '2026-03-04T12:00:00-05:00',
    updateDate: VOTE_UPDATED,
    voteQuestion: 'On Passage',
    voteType: 'Yea-and-Nay',
    result: 'Passed',
    legislationType: 'HR',
    legislationNumber: '101',
    sourceDataURL: `https://clerk.house.gov/evs/${session === 1 ? 2025 : 2026}/roll${String(roll).padStart(3, '0')}.xml`,
    results: [
      {
        bioguideID: 'X000001',
        firstName: 'Harper',
        lastName: 'House',
        voteCast: 'Yea',
        voteParty: 'I',
        voteState: 'KY',
      },
      {
        bioguideID: 'X000002',
        firstName: 'Robin',
        lastName: 'Newmember',
        voteCast: session === 1 ? 'Nay' : 'Not Voting',
        voteParty: 'I',
        voteState: 'OH',
      },
      {
        bioguideID: 'X000099',
        firstName: 'Una',
        lastName: 'Unknown',
        voteCast: 'Present',
        voteParty: 'I',
        voteState: 'GU',
      },
    ],
  },
});

let broken = false;
const requested: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  requested.push(url.toString());
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const page = (key: string, items: unknown[]) => ({
    [key]: items,
    pagination: { count: items.length, next: null },
  });
  const p = url.pathname;
  if (p.endsWith('legislators-current.json')) return json(CURRENT);
  if (p.endsWith('legislators-historical.json')) return json(HISTORICAL);
  if (p === '/v3/member/congress/119') {
    return json(broken ? { members: [{ bioguideId: 'bad' }] } : page('members', MEMBERS));
  }
  if (p === '/v3/bill/119') return json(page('bills', BILLS()));
  if (p === '/v3/bill/119/hr/101') {
    return json({
      bill: {
        congress: 119,
        type: 'HR',
        number: '101',
        title: 'Example Act',
        introducedDate: '2026-01-15',
        policyArea: { name: 'Government Operations and Politics' },
        latestAction: { actionDate: '2026-02-01', text: 'Referred to committee.' },
        sponsors: [
          {
            bioguideId: 'X000001',
            fullName: 'Rep. House, Harper [I-KY-6]',
            party: 'I',
            state: 'KY',
          },
        ],
        cosponsors: { count: COSPONSORS.length },
        updateDate: BILL_UPDATED,
      },
    });
  }
  if (p === '/v3/bill/119/hr/101/cosponsors') return json(page('cosponsors', COSPONSORS));
  const list = p.match(/^\/v3\/house-vote\/119\/(\d)$/);
  if (list) {
    const session = Number(list[1]);
    return json(
      page('houseRollCallVotes', [
        { congress: 119, sessionNumber: session, rollCallNumber: 7, updateDate: VOTE_UPDATED },
      ]),
    );
  }
  const detail = p.match(/^\/v3\/house-vote\/119\/(\d)\/(\d+)\/members$/);
  if (detail) return json(voteMembers(Number(detail[2]), Number(detail[1])));
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const opts = {
  fetch: fakeFetch,
  sleep: async () => {},
  today: '2026-11-02',
  baseUrl: 'https://example.test/',
};
const crosswalk = () => runLegislatorCrosswalk(db, opts);
const congressRun = (extra: Rec = {}) =>
  runCongressImport(db, 119, { ...opts, apiKey: 'test-key-123', minIntervalMs: 0, ...extra });

let test: TestDatabase;
let db: Db;
let editor: Actor;
let harperId: number;
let conflictA: number;

const idOwner = async (scheme: 'bioguide' | 'fec_candidate_id' | 'wikidata', value: string) => {
  const [row] = await db
    .select({ personId: schema.personIdentifier.personId })
    .from(schema.personIdentifier)
    .where(
      and(eq(schema.personIdentifier.scheme, scheme), eq(schema.personIdentifier.value, value)),
    );
  return row?.personId;
};

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  const [res] = await db.insert(schema.adminUser).values({
    email: 'editor@test.local',
    name: 'Editor',
    passwordHash: 'x',
    role: 'owner',
  });
  editor = { userId: res.insertId, ipAddress: null };
  // As the FEC import would have left them.
  harperId = await createPerson(db, editor, { fullName: 'Harper House' });
  await addPersonIdentifier(db, editor, harperId, {
    scheme: 'fec_candidate_id',
    value: 'H8KY06901',
  });
  await createPerson(db, editor, { fullName: 'Jamie Sample' });
  conflictA = await createPerson(db, editor, { fullName: 'Casey Conflict' });
  await addPersonIdentifier(db, editor, conflictA, {
    scheme: 'fec_candidate_id',
    value: 'H2TX01999',
  });
  const conflictB = await createPerson(db, editor, { fullName: 'C. Conflict' });
  await addPersonIdentifier(db, editor, conflictB, { scheme: 'bioguide', value: 'X000004' });
});
afterAll(async () => {
  await test?.stop();
});

describe('legislator crosswalk', () => {
  it('links existing people by FEC ID and creates the rest as cited drafts', async () => {
    const { summary } = await crosswalk();
    expect(summary).toMatchObject({ fetched: 6, considered: 5, created: 2, linked: 1 });

    // Matched by FEC ID: gets the Bioguide and Wikidata IDs.
    expect(await idOwner('bioguide', 'X000001')).toBe(harperId);
    expect(await idOwner('wikidata', 'Q9000001')).toBe(harperId);

    const newId = (await idOwner('bioguide', 'X000002'))!;
    const [created] = await db.select().from(schema.person).where(eq(schema.person.id, newId));
    expect(created).toMatchObject({
      fullName: 'Robin A. Newmember',
      sortName: 'Newmember, Robin',
      publishState: 'draft',
    });
    expect(await idOwner('fec_candidate_id', 'H4OH03999')).toBe(newId);
    const cites = await db
      .select({ url: schema.source.url, type: schema.source.sourceType })
      .from(schema.citation)
      .innerJoin(schema.source, eq(schema.source.id, schema.citation.sourceId))
      .where(and(eq(schema.citation.subjectType, 'person'), eq(schema.citation.subjectId, newId)));
    expect(cites).toEqual(
      expect.arrayContaining([
        { url: 'https://bioguide.congress.gov/search/bio/X000002', type: 'government_record' },
        { url: 'https://github.com/unitedstates/congress-legislators', type: 'reference' },
      ]),
    );
    // Former member who served in this Congress is in; one from 1991 is not.
    expect(await idOwner('bioguide', 'X000005')).toBeDefined();
    expect(await idOwner('bioguide', 'X000006')).toBeUndefined();

    // Never guessed.
    expect(await idOwner('bioguide', 'X000003')).toBeUndefined();
    expect(summary.attention.map((a) => [a.bioguideId, a.problem])).toEqual([
      ['X000003', expect.stringContaining('Possible duplicate of Jamie Sample')],
      ['X000004', expect.stringContaining('belong to different people')],
    ]);
    expect(await idOwner('fec_candidate_id', 'H2TX01999')).toBe(conflictA);
  });

  it('changes nothing when run again', async () => {
    const before = (await db.select().from(schema.revision)).length;
    const { summary } = await crosswalk();
    expect(summary).toMatchObject({ created: 0, linked: 0, unchanged: 3 });
    expect((await db.select().from(schema.revision)).length).toBe(before);
  });
});

describe('Congress.gov import', () => {
  it('imports members, bills and House votes, attached by Bioguide ID', async () => {
    const { summary, runId } = await congressRun();
    expect(summary.stoppedEarly).toBeNull();
    expect(summary.members).toMatchObject({ listed: 4, created: 3 });
    expect(summary.attention).toEqual([
      expect.objectContaining({ ref: 'X000004', problem: expect.stringContaining('Atlantis') }),
    ]);
    expect(summary.bills).toMatchObject({ listed: 1, created: 1, sponsorships: 2 });
    expect(summary.votes).toMatchObject({ listed: 2, created: 2, positions: 6 });
    expect(summary.unmatched).toEqual([
      { bioguideId: 'X000099', name: 'Unknown, Una', state: 'GU' },
    ]);

    const record = (await getCongressRecord(db, harperId))!;
    expect(record.memberships).toEqual([
      expect.objectContaining({ congress: 119, chamber: 'house', state: 'KY', district: 6 }),
    ]);
    expect(record.sponsorCount).toBe(1);
    expect(record.voteCount).toBe(2);
    expect(record.votes.map((v) => [v.rollNumber, v.session, v.voteCast])).toEqual([
      [7, 2, 'Yea'],
      [7, 1, 'Yea'],
    ]);
    expect(record.votes[1]!.votedAt.toISOString()).toBe('2025-09-08T22:56:00.000Z');

    // Drafts, each with its source.
    const [vote] = await db
      .select({ publishState: schema.rollCallVote.publishState, url: schema.source.url })
      .from(schema.rollCallVote)
      .innerJoin(schema.source, eq(schema.source.id, schema.rollCallVote.sourceId))
      .where(eq(schema.rollCallVote.session, 1));
    expect(vote).toEqual({
      publishState: 'draft',
      url: 'https://clerk.house.gov/evs/2025/roll007.xml',
    });
    const [b] = await db
      .select({
        title: schema.bill.title,
        publishState: schema.bill.publishState,
        url: schema.source.url,
      })
      .from(schema.bill)
      .innerJoin(schema.source, eq(schema.source.id, schema.bill.sourceId));
    expect(b).toEqual({
      title: 'Example Act',
      publishState: 'draft',
      url: 'https://www.congress.gov/bill/119th-congress/house-bill/101',
    });

    // The raw responses are kept, without the API key.
    const snaps = await db
      .select()
      .from(schema.ingestSnapshot)
      .where(eq(schema.ingestSnapshot.runId, runId));
    expect(snaps.length).toBe(summary.requests);
    expect(snaps.every((s) => !s.url.includes('test-key-123'))).toBe(true);

    // Congress.gov reads "+" in the sort as a space and ignores an encoded "%2B".
    const billList = new URL(requested.find((u) => new URL(u).pathname === '/v3/bill/119')!);
    expect(billList.search).toContain('sort=updateDate+asc');
    expect(billList.searchParams.get('sort')).toBe('updateDate asc');
  });

  it('changes nothing when run again on the same data', async () => {
    const revisions = (await db.select().from(schema.revision)).length;
    const calls = requested.length;
    const { summary } = await congressRun();
    expect(summary.members).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(summary.bills).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(summary.votes).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect((await db.select().from(schema.revision)).length).toBe(revisions);
    // Only the list pages are fetched: 1 member page, 1 bill page, 2 vote pages.
    expect(requested.length - calls).toBe(4);
  });

  it('fetches a bill again when it was last fetched on the day it changed', async () => {
    // Fetched at 10:00 on the day of its last change: a later change that day would
    // have the same date in the list, so the bill must be checked again.
    await db.update(schema.bill).set({ sourceCheckedAt: new Date('2026-10-02T10:00:00Z') });
    const calls = requested.length;
    const { summary } = await congressRun({ parts: ['bills'] });
    expect(summary.bills).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    // The list page, the bill and its cosponsors.
    expect(requested.length - calls).toBe(3);
    const [b] = await db.select().from(schema.bill);
    expect(b!.sourceCheckedAt!.getTime()).toBeGreaterThan(Date.parse('2026-10-03T12:00:00Z'));
    // Now it is known to be current: the next run only reads the list.
    const again = requested.length;
    await congressRun({ parts: ['bills'] });
    expect(requested.length - again).toBe(1);
  });

  it('updates changed records without undoing a reviewer’s publish decision', async () => {
    await db.update(schema.bill).set({ publishState: 'published' });
    BILL_UPDATED = '2026-10-20T00:00:00Z';
    COSPONSORS = [{ ...COSPONSORS[0]!, sponsorshipWithdrawnDate: '2026-10-19' }];
    VOTE_UPDATED = '2026-10-21T00:00:00Z';
    const { summary } = await congressRun();
    expect(summary.bills).toMatchObject({ updated: 1, sponsorships: 1 });
    expect(summary.votes).toMatchObject({ updated: 2 });
    const [b] = await db.select().from(schema.bill);
    expect(b).toMatchObject({ publishState: 'published', sourceUpdatedAt: BILL_UPDATED });
    const [withdrawn] = await db
      .select()
      .from(schema.billSponsorship)
      .where(eq(schema.billSponsorship.bioguideId, 'X000002'));
    expect(withdrawn).toMatchObject({
      role: 'cosponsor',
      withdrawnOn: '2026-10-19',
      isOriginal: true,
    });
    // Positions are replaced, not duplicated.
    expect((await db.select().from(schema.votePosition)).length).toBe(6);
  });

  it('attaches records once an editor gives the person the Bioguide ID', async () => {
    const una = await createPerson(db, editor, { fullName: 'Una Unknown' });
    await addPersonIdentifier(db, editor, una, { scheme: 'bioguide', value: 'X000099' });
    expect((await getCongressRecord(db, una))!.voteCount).toBe(2);
  });

  it('stops cleanly at a request budget, and fails loudly on unexpected data', async () => {
    VOTE_UPDATED = '2026-10-30T00:00:00Z';
    const limited = await congressRun({ parts: ['house-votes'], maxRequests: 2 });
    expect(limited.summary.stoppedEarly).toMatch(/Stopped after 2 requests/);
    expect(limited.summary.votes).toMatchObject({ updated: 1 });
    const [latest] = await listIngestRuns(db, 1);
    expect(latest).toMatchObject({ state: 'succeeded', source: 'congress_gov' });

    broken = true;
    await expect(congressRun({ parts: ['members'] })).rejects.toThrow(/not in the expected format/);
    const [failed] = await listIngestRuns(db, 1);
    expect(failed).toMatchObject({ state: 'failed' });
    broken = false;
  });

  it('acts as its own automated account that cannot sign in', async () => {
    const [bot] = await db
      .select()
      .from(schema.adminUser)
      .where(eq(schema.adminUser.name, 'Automated import (Congress)'));
    expect(bot?.disabledAt).toBeInstanceOf(Date);
    expect(bot?.passwordHash).toBe('!');
  });
});
