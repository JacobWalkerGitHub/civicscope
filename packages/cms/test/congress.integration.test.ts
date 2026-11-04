import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  createPerson,
  getCongressRecord,
  getPublicBill,
  getPublicMember,
  listCurrentMembers,
  listIngestRuns,
  listPublicBills,
  parseBillNumber,
  runCongressImport,
  runLegislatorCrosswalk,
  spotCheckVotes,
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
const sen = (state: string, start = '2025-01-03', end = '2031-01-03') => ({
  type: 'sen',
  start,
  end,
  state,
  party: 'Independent',
});
// Senators, with the LIS IDs the Senate's vote files use.
CURRENT.push(
  legislator('X000010', 'Avery', 'Senator', ['S6KY00999'], [sen('KY')], {}),
  legislator('X000011', 'Blair', 'Appointee', [], [sen('OH', '2025-01-21', '2026-12-31')]),
);
(CURRENT.at(-2)!.id as Rec).lis = 'S901';
(CURRENT.at(-1)!.id as Rec).lis = 'S902';

const HISTORICAL: Rec[] = [
  // Left during the 119th Congress: in scope.
  legislator('X000005', 'Morgan', 'Former', [], [rep('NY', 21, '2023-01-03', '2025-04-01')]),
  // Left the Senate early in the 119th Congress: only in the historical file.
  legislator('X000012', 'Drew', 'Departed', [], [sen('OH', '2019-01-03', '2025-01-10')]),
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
/** Replaces the bill list for one test. */
let BILL_LIST: Rec[] | null = null;
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

(HISTORICAL[1]!.id as Rec).lis = 'S903';

/*
 * Senate vote files in senate.gov's XML format (see packages/core/src/__fixtures__ for
 * real ones). Made-up senators and votes.
 */
interface SenMember {
  lis: string;
  first: string;
  last: string;
  state: string;
  cast: string;
}
let SENATE_MODIFIED = 'January 9, 2025,  06:00 PM';
let SENATE_VOTES: Record<string, { date: string; members: SenMember[]; tie?: string }> = {
  '1:1': {
    date: 'January 9, 2025,  05:33 PM',
    members: [
      { lis: 'S901', first: 'Avery', last: 'Senator', state: 'KY', cast: 'Yea' },
      { lis: 'S903', first: 'Drew', last: 'Departed', state: 'OH', cast: 'Nay' },
      { lis: 'S999', first: 'Not', last: 'Listedyet', state: 'NJ', cast: 'Yea' },
    ],
  },
  '1:2': {
    date: 'July 15, 2025,  11:05 AM',
    members: [
      { lis: 'S901', first: 'Avery', last: 'Senator', state: 'KY', cast: 'Nay' },
      { lis: 'S902', first: 'Blair', last: 'Appointee', state: 'OH', cast: 'Yea' },
    ],
  },
  '2:1': {
    date: 'March 4, 2026,  02:15 PM',
    tie: 'Yea',
    members: [{ lis: 'S901', first: 'Avery', last: 'Senator', state: 'KY', cast: 'Yea' }],
  },
};
const senateMenu = (session: number) => {
  const votes = Object.keys(SENATE_VOTES)
    .filter((k) => k.startsWith(`${session}:`))
    .map((k) => Number(k.split(':')[1]))
    .sort((a, b) => b - a)
    .map(
      (n) =>
        `<vote><vote_number>${String(n).padStart(5, '0')}</vote_number><vote_date>09-Jan</vote_date><issue>S. 5</issue><question>On Passage of the Bill\n         </question><result>Passed</result><vote_tally><yeas>1</yeas><nays>1</nays></vote_tally><title>Example</title></vote>`,
    );
  return `<?xml version="1.0" encoding="UTF-8"?><vote_summary><congress>119</congress><session>${session}</session><congress_year>${2024 + session}</congress_year><votes>${votes.join('')}</votes></vote_summary>`;
};
const senateVote = (session: number, roll: number) => {
  const v = SENATE_VOTES[`${session}:${roll}`]!;
  const members = v.members
    .map(
      (m) =>
        `<member><member_full>${m.last} (I-${m.state})</member_full><last_name>${m.last}</last_name><first_name>${m.first}</first_name><party>I</party><state>${m.state}</state><vote_cast>${m.cast}</vote_cast><lis_member_id>${m.lis}</lis_member_id></member>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><roll_call_vote><congress>119</congress><session>${session}</session><congress_year>${2024 + session}</congress_year><vote_number>${roll}</vote_number><vote_date>${v.date}</vote_date><modify_date>${SENATE_MODIFIED}</modify_date><vote_question_text>On Passage of the Bill S. 5</vote_question_text><vote_document_text/><vote_result_text>Bill Passed (2-1)</vote_result_text><question>On Passage of the Bill</question><vote_title>S. 5 as Amended</vote_title><majority_requirement>1/2</majority_requirement><vote_result>Bill Passed</vote_result><document><document_congress>119</document_congress><document_type>S.</document_type><document_number>5</document_number><document_name>S. 5</document_name><document_title/><document_short_title/></document><amendment><amendment_number/><amendment_to_amendment_number/><amendment_to_amendment_to_amendment_number/><amendment_to_document_number/><amendment_to_document_short_title/><amendment_purpose/></amendment><count><yeas>2</yeas><nays>1</nays><present/><absent/></count><tie_breaker>${v.tie ? `<by_whom>Vice President</by_whom><tie_breaker_vote>${v.tie}</tie_breaker_vote>` : '<by_whom/><tie_breaker_vote/>'}</tie_breaker><members>${members}</members></roll_call_vote>`;
};

/*
 * Voteview's Senate files for the 119th Congress, in its CSV format: the same made-up
 * senators. Voteview's roll call 1 is the Senate's session 1 roll call 1, already stored
 * from senate.gov above.
 */
const VV_MEMBER_HEADER =
  'congress,chamber,icpsr,state_icpsr,district_code,state_abbrev,party_code,occupancy,last_means,bioname,bioguide_id,born,died';
let VV_NOTYET_BIOGUIDE = '';
const vvMembers = () =>
  [
    VV_MEMBER_HEADER,
    '119,President,99912,99,0,USA,200,0,0,"PRESIDENT, The",,1950.0,',
    '119,Senate,90010,51,0,KY,328,,,"SENATOR, Avery",X000010,1960.0,',
    '119,Senate,90011,24,0,OH,100,,,"APPOINTEE, Blair",X000011,1970.0,',
    `119,Senate,90099,12,0,NJ,200,,,"LISTEDYET, Not",${VV_NOTYET_BIOGUIDE},1980.0,`,
  ].join('\n');
const VV_ROLLCALLS = [
  'congress,chamber,rollnumber,date,session,clerk_rollnumber,majority_requirement,yea_count,nay_count,nominate_mid_1,bill_number,vote_result,vote_desc,vote_question,dtl_desc',
  '119,Senate,1,2025-01-09,1,1,1/2,1,1,0.1,S5,Bill Passed,"A bill, made up.",On Passage of the Bill,',
  '119,Senate,3,2025-07-16,1,3,3/5,1,1,0.1,HR101,Cloture Motion Agreed to,"Example Act, a made-up bill.",On the Cloture Motion,',
  '119,Senate,4,2026-03-05,2,2,1/2,2,0,0.1,PN123,Nomination Confirmed,"Someone, to be Something",On the Nomination,',
  // Its totals don't match the senators' votes below.
  '119,Senate,5,2026-03-06,2,3,1/2,5,0,0.1,S9,Bill Passed,,On Passage of the Bill,',
].join('\r\n');
const VV_VOTES = [
  'congress,chamber,rollnumber,icpsr,cast_code,prob',
  '119,Senate,1,90010,1,99.0',
  '119,Senate,3,90010,1,99.0',
  '119,Senate,3,90011,6,99.0',
  // The President's stated position: not a Senate vote.
  '119,Senate,3,99912,1,99.0',
  '119,Senate,4,90010,9,99.0',
  // Paired yea: counted in Voteview's yeas, recorded by the Senate as not voting.
  '119,Senate,4,90011,2,99.0',
  '119,Senate,4,90099,1,99.0',
  '119,Senate,5,90010,1,99.0',
].join('\n');
let vvBroken = false;

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
  const xml = (body: string) => new Response(body, { status: 200 });
  const menu = p.match(/^\/legislative\/LIS\/roll_call_lists\/vote_menu_119_(\d)\.xml$/);
  if (menu) return xml(senateMenu(Number(menu[1])));
  const sv = p.match(
    /^\/legislative\/LIS\/roll_call_votes\/vote119(\d)\/vote_119_\d_(\d{5})\.xml$/,
  );
  if (sv) {
    if (broken) return xml('<html><body>Error</body></html>');
    return xml(senateVote(Number(sv[1]), Number(sv[2])));
  }
  const vv = p.match(/^\/static\/data\/out\/(rollcalls|votes|members)\/S119_\1\.csv$/);
  if (vv) {
    const csv = (body: string) => new Response(body, { status: 200 });
    if (vv[1] === 'members') {
      return csv(vvBroken ? vvMembers().replace('bioguide_id', 'bioguide') : vvMembers());
    }
    return csv(vv[1] === 'rollcalls' ? VV_ROLLCALLS : VV_VOTES);
  }
  if (p.endsWith('legislators-current.json')) return json(CURRENT);
  if (p.endsWith('legislators-historical.json')) return json(HISTORICAL);
  if (p === '/v3/member/congress/119') {
    return json(broken ? { members: [{ bioguideId: 'bad' }] } : page('members', MEMBERS));
  }
  if (p === '/v3/bill/119') return json(page('bills', BILL_LIST ?? BILLS()));
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
        summaries: { count: 2 },
        textVersions: { count: 1 },
        updateDate: BILL_UPDATED,
      },
    });
  }
  if (p === '/v3/bill/119/hr/101/summaries') {
    return json({
      summaries: [
        {
          actionDate: '2026-01-15',
          actionDesc: 'Introduced in House',
          text: '<p><strong>Example Act</strong></p><p>This bill does things &amp; more.</p>',
          updateDate: '2026-01-20T00:00:00Z',
        },
        {
          actionDate: '2026-01-30',
          actionDesc: 'Reported to House',
          text: '<p>The reported version.</p>',
          updateDate: '2026-02-01T00:00:00Z',
        },
      ],
    });
  }
  if (p === '/v3/bill/119/hr/101/text') {
    return json({
      textVersions: [
        {
          date: '2026-01-15T05:00:00Z',
          type: 'Introduced in House',
          formats: [
            { type: 'PDF', url: 'https://www.congress.gov/119/bills/hr101/BILLS-119hr101ih.pdf' },
            {
              type: 'Formatted Text',
              url: 'https://www.congress.gov/119/bills/hr101/BILLS-119hr101ih.htm',
            },
          ],
        },
      ],
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
  runCongressImport(db, 119, {
    ...opts,
    apiKey: 'test-key-123',
    minIntervalMs: 0,
    parts: ['members', 'bills', 'house-votes'],
    ...extra,
  });

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
    // 6 representatives and 3 senators; 2 are out of scope or already linked.
    expect(summary).toMatchObject({ fetched: 9, considered: 8, created: 5, linked: 1 });

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
    expect(summary).toMatchObject({ created: 0, linked: 0, unchanged: 6 });
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
    // The latest summary, as text; the latest printed version; the stage.
    const [full] = await db.select().from(schema.bill);
    expect(full).toMatchObject({
      stage: 'committee',
      summary: 'The reported version.',
      summaryVersion: 'Reported to House',
      summaryDate: '2026-01-30',
      textUrl: 'https://www.congress.gov/119/bills/hr101/BILLS-119hr101ih.htm',
      textVersion: 'Introduced in House',
      textDate: '2026-01-15',
    });
    expect(full!.extrasCheckedAt).not.toBeNull();

    // The public view shows imported records, with their source, until an editor takes
    // one down.
    const pub = (await getCongressRecord(db, harperId, 20, { publicOnly: true }))!;
    expect(pub.voteCount).toBe(2);
    expect(pub.votes[1]!.sourceUrl).toBe('https://clerk.house.gov/evs/2025/roll007.xml');
    await db
      .update(schema.rollCallVote)
      .set({ publishState: 'unpublished' })
      .where(eq(schema.rollCallVote.session, 1));
    const hidden = (await getCongressRecord(db, harperId, 20, { publicOnly: true }))!;
    expect(hidden.voteCount).toBe(1);
    expect(hidden.votes.map((v) => v.session)).toEqual([2]);
    expect((await getCongressRecord(db, harperId))!.voteCount).toBe(2);
    await db
      .update(schema.rollCallVote)
      .set({ publishState: 'draft' })
      .where(eq(schema.rollCallVote.session, 1));

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

  it('shows bills with their sponsors and votes, and current members', async () => {
    const list = await listPublicBills(db, { tab: 'progress' });
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({
      label: 'H.R. 101',
      stage: 'committee',
      hasSummary: true,
      sponsor: { bioguideId: 'X000001', name: 'Harper House', party: 'I', state: 'KY' },
    });
    expect((await listPublicBills(db, { tab: 'outcomes' })).total).toBe(0);
    expect((await listPublicBills(db, { q: 'hr 101' })).total).toBe(1);
    expect((await listPublicBills(db, { q: 'Example' })).total).toBe(1);
    expect((await listPublicBills(db, { q: 'Nothing like it' })).total).toBe(0);
    expect((await listPublicBills(db, { chamber: 'senate' })).total).toBe(0);
    expect(parseBillNumber('H.R. 3424')).toEqual({ type: 'hr', number: 3424 });
    expect(parseBillNumber('S 5')).toEqual({ type: 's', number: 5 });
    expect(parseBillNumber('Tax cuts')).toBeNull();

    const page = (await getPublicBill(db, 119, 'hr', 101))!;
    expect(page.bill).toMatchObject({ label: 'H.R. 101', summary: 'The reported version.' });
    expect(page.sponsors.map((s) => s.name)).toEqual(['Harper House']);
    expect(page.cosponsors).toEqual([
      expect.objectContaining({
        bioguideId: 'X000002',
        name: 'Robin A. Newmember',
        isOriginal: true,
      }),
    ]);
    // Both House votes on the bill, newest first, with a tally and every member's vote.
    expect(page.votes.map((v) => [v.session, v.tally])).toEqual([
      [2, { yes: 1, no: 0, present: 1, absent: 1, other: 0 }],
      [1, { yes: 1, no: 1, present: 1, absent: 0, other: 0 }],
    ]);
    expect(page.votes[1]!.positions.map((p) => [p.name, p.voteCast])).toEqual([
      ['Harper House', 'Yea'],
      ['Robin A. Newmember', 'Nay'],
      ['Una Unknown', 'Present'],
    ]);
    // Profile links only for published people.
    expect(page.sponsors[0]!.personSlug).toBeNull();
    await db
      .update(schema.person)
      .set({ publishState: 'published' })
      .where(eq(schema.person.id, harperId));
    expect((await getPublicBill(db, 119, 'hr', 101))!.sponsors[0]!.personSlug).not.toBeNull();
    await db
      .update(schema.person)
      .set({ publishState: 'draft' })
      .where(eq(schema.person.id, harperId));
    expect(await getPublicBill(db, 119, 'hr', 999)).toBeNull();
    expect(await getPublicBill(db, 119, 'xyz', 101)).toBeNull();

    const members = await listCurrentMembers(db, {}, '2026-11-02');
    expect(members.congress).toBe(119);
    expect(members.rows.map((m) => [m.name, m.state, m.district])).toEqual([
      ['Harper House', 'KY', 6],
      ['Robin A. Newmember', 'OH', 3],
      ['Una Unknown', 'GU', 0],
    ]);
    expect((await listCurrentMembers(db, { state: 'oh' }, '2026-11-02')).rows).toHaveLength(1);
    expect((await listCurrentMembers(db, { q: 'harp' }, '2026-11-02')).rows).toHaveLength(1);

    const harper = (await getPublicMember(db, 'X000001'))!;
    expect(harper.member.name).toBe('Harper House');
    expect(harper.sponsorCount).toBe(1);
    expect(harper.votes.map((v) => [v.voteCast, v.bill?.label])).toEqual([
      ['Yea', 'H.R. 101'],
      ['Yea', 'H.R. 101'],
    ]);
    expect(await getPublicMember(db, 'Z999999')).toBeNull();
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
    // The list page, the bill, its cosponsors, summaries and text.
    expect(requested.length - calls).toBe(5);
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

  it('handles a bill listed twice in one run', async () => {
    // Congress.gov pages its list by offset over a date-only sort, so a bill can turn up
    // on two pages of the same run. The second time it must update, not insert again.
    await db.delete(schema.billSponsorship);
    await db.delete(schema.bill);
    BILL_LIST = [...BILLS(), ...BILLS()];
    try {
      const { summary } = await congressRun({ parts: ['bills'] });
      expect(summary.bills).toMatchObject({ listed: 2, created: 1 });
      expect(await db.select().from(schema.bill)).toHaveLength(1);
    } finally {
      BILL_LIST = null;
    }
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

describe('Senate votes from senate.gov', () => {
  const senateRun = (extra: Rec = {}) =>
    runCongressImport(db, 119, {
      ...opts,
      apiKey: '',
      senateSource: 'senate.gov',
      senateBaseUrl: 'https://senate.test',
      minIntervalMs: 0,
      parts: ['senate-votes'],
      ...extra,
    });
  const personFor = async (bioguide: string) => (await idOwner('bioguide', bioguide))!;

  it('imports Senate votes and attaches them by LIS ID, without a Congress.gov key', async () => {
    const calls = requested.length;
    const { summary } = await senateRun();
    const urls = requested.slice(calls);
    expect(urls.some((u) => u.includes('api_key') || u.includes('example.test/v3'))).toBe(false);
    expect(summary.senateVotes).toMatchObject({ listed: 3, created: 3, positions: 5 });
    // A senator congress-legislators doesn't list yet: named, not guessed.
    expect(summary.attention).toEqual([
      expect.objectContaining({ ref: 'Senate LIS ID S999', name: 'Not Listedyet' }),
    ]);
    // The historical file was needed for a senator who left in January 2025.
    expect(urls.filter((u) => u.endsWith('legislators-historical.json'))).toHaveLength(1);

    const avery = (await getCongressRecord(db, await personFor('X000010')))!;
    expect(avery.voteCount).toBe(3);
    expect(avery.votes.map((v) => [v.chamber, v.session, v.rollNumber, v.voteCast])).toEqual([
      ['senate', 2, 1, 'Yea'],
      ['senate', 1, 2, 'Nay'],
      ['senate', 1, 1, 'Yea'],
    ]);
    // Eastern time: 11:05 AM in July is 15:05 UTC.
    expect(avery.votes[1]!.votedAt.toISOString()).toBe('2025-07-15T15:05:00.000Z');
    expect(avery.votes[0]!.result).toBe('Bill Passed (tie broken by the Vice President: Yea)');
    expect(avery.votes[1]).toMatchObject({ legislationType: 'S.', legislationNumber: '5' });
    const drew = (await getCongressRecord(db, await personFor('X000012')))!;
    expect(drew.votes.map((v) => v.voteCast)).toEqual(['Nay']);

    const [vote] = await db
      .select({ publishState: schema.rollCallVote.publishState, url: schema.source.url })
      .from(schema.rollCallVote)
      .innerJoin(schema.source, eq(schema.source.id, schema.rollCallVote.sourceId))
      .where(and(eq(schema.rollCallVote.chamber, 'senate'), eq(schema.rollCallVote.rollNumber, 2)));
    expect(vote).toEqual({
      publishState: 'draft',
      url: 'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00002.htm',
    });
  });

  it('only fetches votes it doesn’t have, plus votes it couldn’t fully attach', async () => {
    const revisions = (await db.select().from(schema.revision)).length;
    const calls = requested.length;
    const { summary } = await senateRun();
    // Two menus, roll call 1 again (S999 is still unknown), and both legislators files.
    expect(requested.length - calls).toBe(5);
    expect(summary.senateVotes).toMatchObject({ listed: 3, created: 0, updated: 0, unchanged: 3 });
    expect((await db.select().from(schema.revision)).length).toBe(revisions);
  });

  it('completes a vote once congress-legislators lists the missing senator', async () => {
    CURRENT.push(legislator('X000013', 'Not', 'Listedyet', [], [sen('NJ', '2025-01-06')]));
    (CURRENT.at(-1)!.id as Rec).lis = 'S999';
    const { summary } = await senateRun();
    expect(summary.senateVotes).toMatchObject({ updated: 1, positions: 3 });
    expect(summary.attention).toEqual([]);
    // Stored; attaches when the crosswalk creates the person.
    expect(summary.unmatched).toEqual([
      { bioguideId: 'X000013', name: 'Not Listedyet', state: 'NJ' },
    ]);
    await crosswalk();
    const record = (await getCongressRecord(db, await personFor('X000013')))!;
    expect(record.votes.map((v) => v.voteCast)).toEqual(['Yea']);

    // Now every vote is complete: only the two menus are read.
    const calls = requested.length;
    await senateRun();
    expect(requested.length - calls).toBe(2);
  });

  it('picks up corrections when asked to refresh, and leaves publish decisions alone', async () => {
    await db
      .update(schema.rollCallVote)
      .set({ publishState: 'published' })
      .where(eq(schema.rollCallVote.chamber, 'senate'));
    const same = await senateRun({ refreshSenateVotes: true });
    expect(same.summary.senateVotes).toMatchObject({ unchanged: 3, updated: 0 });

    SENATE_MODIFIED = 'January 10, 2025,  09:00 AM';
    SENATE_VOTES = {
      ...SENATE_VOTES,
      '1:2': {
        ...SENATE_VOTES['1:2']!,
        members: SENATE_VOTES['1:2']!.members.map((m) =>
          m.lis === 'S902' ? { ...m, cast: 'Not Voting' } : m,
        ),
      },
    };
    const { summary } = await senateRun({ refreshSenateVotes: true });
    expect(summary.senateVotes).toMatchObject({ updated: 3 });
    const blair = (await getCongressRecord(db, await personFor('X000011')))!;
    expect(blair.votes.map((v) => v.voteCast)).toEqual(['Not Voting']);
    const states = await db
      .select({ s: schema.rollCallVote.publishState })
      .from(schema.rollCallVote)
      .where(eq(schema.rollCallVote.chamber, 'senate'));
    expect(states.every((r) => r.s === 'published')).toBe(true);
    // Positions are replaced, not duplicated.
    expect(blair.voteCount).toBe(1);
  });

  it('passes the spot check against the stored Senate files', async () => {
    const res = await spotCheckVotes(db, { ...opts, chamber: 'senate', sample: 50 });
    // Avery 3, Blair 1, Drew 1, Not Listedyet 1.
    expect(res.checked).toBe(6);
    expect(res.rows.filter((r) => r.problems.length)).toEqual([]);

    // Swapping two senators' Bioguide IDs makes both fail.
    const a = await personFor('X000010');
    const b = await personFor('X000011');
    const ids = schema.personIdentifier;
    await db.update(ids).set({ value: 'TMP0000' }).where(eq(ids.value, 'X000010'));
    await db.update(ids).set({ value: 'X000010' }).where(eq(ids.value, 'X000011'));
    await db.update(ids).set({ value: 'X000011' }).where(eq(ids.value, 'TMP0000'));
    const swapped = await spotCheckVotes(db, { ...opts, chamber: 'senate', sample: 50 });
    expect(
      swapped.rows
        .filter((r) => r.problems.length)
        .map((r) => r.personId)
        .sort(),
    ).toEqual([a, b, b, b].sort());
    await db.update(ids).set({ value: 'TMP0000' }).where(eq(ids.value, 'X000010'));
    await db.update(ids).set({ value: 'X000010' }).where(eq(ids.value, 'X000011'));
    await db.update(ids).set({ value: 'X000011' }).where(eq(ids.value, 'TMP0000'));
  });

  it('fails loudly when senate.gov sends something that is not a vote', async () => {
    broken = true;
    await expect(senateRun({ refreshSenateVotes: true })).rejects.toThrow(
      /from senate\.gov is not in the expected format/,
    );
    broken = false;
    const [failed] = await listIngestRuns(db, 1);
    expect(failed).toMatchObject({ state: 'failed', source: 'congress_gov' });
  });
});

describe('Senate votes from Voteview', () => {
  const voteviewRun = (extra: Rec = {}) =>
    runCongressImport(db, 119, {
      ...opts,
      apiKey: '',
      voteviewBaseUrl: 'https://voteview.test',
      minIntervalMs: 0,
      parts: ['senate-votes'],
      ...extra,
    });
  const personFor = async (bioguide: string) => (await idOwner('bioguide', bioguide))!;

  it('imports Senate votes from Voteview by default, attached by Bioguide ID', async () => {
    const calls = requested.length;
    const { summary } = await voteviewRun();
    const urls = requested.slice(calls);
    expect(urls.map((u) => new URL(u).pathname).sort()).toEqual([
      '/static/data/out/members/S119_members.csv',
      '/static/data/out/rollcalls/S119_rollcalls.csv',
      '/static/data/out/votes/S119_votes.csv',
    ]);
    expect(urls.some((u) => u.includes('senate.test') || u.includes('api_key'))).toBe(false);
    // Roll call 1 is already stored from senate.gov and is left as the Senate published it.
    expect(summary.senateVotes).toMatchObject({
      listed: 4,
      created: 2,
      updated: 0,
      unchanged: 1,
      positions: 4,
    });
    expect(summary.attention).toEqual([
      expect.objectContaining({ ref: 'Voteview ICPSR 90099', name: 'LISTEDYET, Not' }),
      expect.objectContaining({ ref: 'Senate roll call 3, 2026' }),
    ]);

    const avery = (await getCongressRecord(db, await personFor('X000010')))!;
    const fromVoteview = avery.votes.filter((v) => v.sourceUrl?.startsWith('https://voteview'));
    expect(
      fromVoteview.map((v) => [v.session, v.rollNumber, v.voteCast, v.party, v.state]),
    ).toEqual([
      [2, 2, 'Not Voting', 'I', 'KY'],
      [1, 3, 'Yea', 'I', 'KY'],
    ]);
    expect(fromVoteview[1]).toMatchObject({
      question: 'On the Cloture Motion: Example Act, a made-up bill.',
      result: 'Cloture Motion Agreed to',
      legislationType: 'HR',
      legislationNumber: '101',
      sourceUrl: 'https://voteview.com/rollcall/RS1190003',
      sourcePublisher: "Voteview (UCLA), from the U.S. Senate's roll-call record",
    });
    // Voteview gives only the date: stored at midday Eastern so it shows on that day.
    expect(fromVoteview[1]!.votedAt.toISOString()).toBe('2025-07-16T17:00:00.000Z');
    // A paired yea is recorded as the Senate tallies it.
    const blair = (await getCongressRecord(db, await personFor('X000011')))!;
    expect(
      blair.votes
        .filter((v) => v.sourceUrl?.startsWith('https://voteview'))
        .map((v) => [v.rollNumber, v.voteCast, v.party]),
    ).toEqual([
      [2, 'Not Voting', 'D'],
      [3, 'Nay', 'D'],
    ]);

    // The Senate vote shows on the bill's page next to the House votes.
    const page = (await getPublicBill(db, 119, 'hr', 101))!;
    const senate = page.votes.filter((v) => v.chamber === 'senate');
    expect(senate).toEqual([
      expect.objectContaining({
        congress: 119,
        session: 1,
        rollNumber: 3,
        sourceUrl: 'https://voteview.com/rollcall/RS1190003',
      }),
    ]);

    const [source] = await db
      .select()
      .from(schema.source)
      .where(eq(schema.source.url, 'https://voteview.com/rollcall/RS1190003'));
    expect(source).toMatchObject({
      sourceType: 'legislative_record',
      retrievedAt: '2026-11-02',
    });
    expect(source!.title).toBe('Senate roll call 3, 2025: On the Cloture Motion (HR101)');
  });

  it('changes nothing when Voteview’s files are the same', async () => {
    const revisions = (await db.select().from(schema.revision)).length;
    const { summary } = await voteviewRun();
    expect(summary.senateVotes).toMatchObject({ listed: 4, created: 0, updated: 0, unchanged: 3 });
    expect((await db.select().from(schema.revision)).length).toBe(revisions);
  });

  it('completes a vote once Voteview lists the senator’s Bioguide ID', async () => {
    VV_NOTYET_BIOGUIDE = 'X000013';
    const { summary } = await voteviewRun();
    expect(summary.senateVotes).toMatchObject({ updated: 1, positions: 3 });
    expect(summary.attention).toEqual([
      expect.objectContaining({ ref: 'Senate roll call 3, 2026' }),
    ]);
    const record = (await getCongressRecord(db, await personFor('X000013')))!;
    expect(record.votes.map((v) => [v.rollNumber, v.voteCast])).toEqual([
      [2, 'Yea'],
      [1, 'Yea'],
    ]);
  });

  it('passes the spot check against Voteview’s stored senator list', async () => {
    const res = await spotCheckVotes(db, { ...opts, chamber: 'senate', sample: 50 });
    // Six from senate.gov, five from Voteview.
    expect(res.checked).toBe(11);
    expect(res.rows.filter((r) => r.problems.length)).toEqual([]);
  });

  it('fails loudly when a Voteview file is missing a column', async () => {
    vvBroken = true;
    await expect(voteviewRun()).rejects.toThrow(
      /Voteview's Senate members file for the 119th Congress is not in the expected format \(missing column bioguide_id\)/,
    );
    vvBroken = false;
  });
});
