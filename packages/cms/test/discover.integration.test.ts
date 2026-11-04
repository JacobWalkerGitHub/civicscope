import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedIssues, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  addStatusEvent,
  approveClaim,
  createCandidacy,
  createClaim,
  createElection,
  createOffice,
  createPerson,
  createRace,
  getPublicComparison,
  getPublicIssue,
  listPublicIssues,
  searchPublic,
  searchTerms,
  setCandidacyPublishState,
  setPersonPublishState,
  setPublishState,
  submitClaimForReview,
  type Actor,
} from '../src/index';

/** Fixture values only: not real candidates, statements or election data. */
let test: TestDatabase;
let db: Db;
let owner: Actor;
const ids = {} as Record<string, number>;
let issueA: { id: number; slug: string; name: string };
let issueB: { id: number; slug: string; name: string };

const official = {
  sourceUrl: 'https://elect.state.example/2027/list',
  sourceTitle: 'Candidate list (example)',
  sourcePublisher: 'State Board of Elections (example)',
  sourceType: 'official_election_authority',
};

async function cite(type: 'person' | 'candidacy' | 'claim', id: number) {
  await addCitation(db, owner, { ...official, subjectType: type, subjectId: String(id) });
}

async function person(name: string, publish = true) {
  const id = await createPerson(db, owner, { fullName: name });
  await cite('person', id);
  if (publish) await setPersonPublishState(db, owner, id, 'published');
  return id;
}

async function runs(personId: number, raceId: number, publish = true) {
  const id = await createCandidacy(db, owner, {
    personId: String(personId),
    raceId: String(raceId),
  });
  await addStatusEvent(db, owner, id, {
    ...official,
    status: 'filed',
    effectiveDate: '2026-01-20',
  });
  if (publish) await setCandidacyPublishState(db, owner, id, 'published');
  return id;
}

async function position(personId: number, issueId: number, title: string, publish = true) {
  const id = await createClaim(db, owner, {
    personId: String(personId),
    kind: 'position',
    contentKind: 'candidate_claim',
    title,
    summary: `${title}, in the candidate's words.`,
    quote: 'Example quote for the fixture.',
    issueId: String(issueId),
    positionType: 'stated_position',
  });
  await cite('claim', id);
  if (publish) {
    await submitClaimForReview(db, owner, id);
    await approveClaim(db, owner, id, 'Checked');
  }
  return id;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  await seedIssues(db);
  const [res] = await db.insert(schema.adminUser).values({
    email: 'owner@test.local',
    name: 'Owner',
    passwordHash: 'x',
    role: 'owner',
  });
  owner = { userId: res.insertId, ipAddress: null };
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  [issueA, issueB] = (await db
    .select({ id: schema.issue.id, slug: schema.issue.slug, name: schema.issue.name })
    .from(schema.issue)
    .orderBy(schema.issue.name)
    .limit(2)) as [typeof issueA, typeof issueB];
  const office = async (title: string) =>
    createOffice(db, owner, {
      jurisdictionId: String(ky!.id),
      title,
      level: 'state',
      branch: 'executive',
      isPartisan: 'on',
    });
  const auditor = await office('Example Auditor');
  const treasurer = await office('Example Treasurer');

  ids.election = await createElection(db, owner, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example general 2027',
  });
  await setPublishState(db, owner, 'election', ids.election, 'published');
  for (const [key, officeId, name] of [
    ['auditor', auditor, 'Example Auditor'],
    ['treasurer', treasurer, 'Example Treasurer'],
  ] as const) {
    ids[key] = await createRace(db, owner, { electionId: ids.election, officeId, name });
    await setPublishState(db, owner, 'race', ids[key]!, 'published');
  }

  // Auditor race: Ada (two positions, one on each issue), Ben (nothing on file),
  // Dee (draft person, never shown). Treasurer race: Cy.
  ids.ada = await person('Ada Lovelock');
  ids.adaRun = await runs(ids.ada, ids.auditor!);
  ids.adaPosA = await position(ids.ada, issueA.id, 'Backs quarterly ledger reviews');
  ids.adaPosB = await position(ids.ada, issueB.id, 'Opposes surplus transfers');
  ids.adaDraft = await position(ids.ada, issueA.id, 'Unreviewed zeppelin statement', false);
  ids.ben = await person('Ben Ortega');
  ids.benRun = await runs(ids.ben, ids.auditor!);
  ids.dee = await person('Dee Hidden', false);
  ids.deeRun = await runs(ids.dee, ids.auditor!, false);
  ids.cy = await person('Cy Treadwell');
  ids.cyRun = await runs(ids.cy, ids.treasurer!);
  await position(ids.cy, issueA.id, 'Backs quarterly ledger publication');
});
afterAll(async () => {
  await test?.stop();
});

describe('search', () => {
  it('splits a query into at most eight lowercase words without LIKE wildcards', () => {
    expect(searchTerms('  Ada%  LOVE_lock, ky ')).toEqual(['ada', 'love', 'lock', 'ky']);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
  });

  it('finds candidates by name, office or state, every word required', async () => {
    const byName = await searchPublic(db, 'lovelock');
    expect(byName.candidates.map((c) => c.ballotName)).toEqual(['Ada Lovelock']);
    const byOffice = await searchPublic(db, 'treasurer kentucky');
    expect(byOffice.candidates.map((c) => c.ballotName)).toEqual(['Cy Treadwell']);
    expect(byOffice.races.map((r) => r.name)).toEqual(['Example Treasurer']);
    const none = await searchPublic(db, 'treasurer lovelock');
    expect(none.candidates).toEqual([]);
  });

  it('never returns a draft person or an unpublished entry', async () => {
    expect((await searchPublic(db, 'hidden')).candidates).toEqual([]);
    expect((await searchPublic(db, 'zeppelin')).entries).toEqual([]);
  });

  it('searches the text of published entries', async () => {
    const r = await searchPublic(db, 'quarterly ledger');
    expect(r.entries.map((e) => e.title).sort()).toEqual([
      'Backs quarterly ledger publication',
      'Backs quarterly ledger reviews',
    ]);
    expect((await searchPublic(db, 'ledg')).entries).toHaveLength(2);
  });

  it('finds issues by name', async () => {
    const r = await searchPublic(db, issueA.name);
    expect(r.issues.map((i) => i.slug)).toContain(issueA.slug);
  });

  it('leaves out past elections unless asked', async () => {
    expect((await searchPublic(db, 'lovelock', { today: '2028-01-01' })).candidates).toEqual([]);
    const past = await searchPublic(db, 'lovelock', { today: '2028-01-01', includePast: true });
    expect(past.candidates).toHaveLength(1);
  });

  it('returns nothing for an empty or one-letter query', async () => {
    expect((await searchPublic(db, '   ')).candidates).toEqual([]);
    expect((await searchPublic(db, 'a')).candidates).toEqual([]);
  });
});

describe('comparison', () => {
  it('compares only public candidates in the same race and reports the rest', async () => {
    const c = await getPublicComparison(db, ids.auditor!, [ids.adaRun!, ids.cyRun!, ids.deeRun!]);
    expect(c!.columns.map((x) => x.ballotName)).toEqual(['Ada Lovelock']);
    expect(c!.ignored.sort()).toEqual([ids.cyRun, ids.deeRun].sort());
  });

  it('defaults to every public candidate in the race, alphabetically', async () => {
    const c = await getPublicComparison(db, ids.auditor!);
    expect(c!.columns.map((x) => x.ballotName)).toEqual(['Ada Lovelock', 'Ben Ortega']);
    expect(c!.candidatesInRace).toHaveLength(2);
    // Only IDs from another race: the race's own candidates, never the other race's.
    const other = await getPublicComparison(db, ids.auditor!, [ids.cyRun!]);
    expect(other!.columns.map((x) => x.ballotName)).toEqual(['Ada Lovelock', 'Ben Ortega']);
    expect(other!.ignored).toEqual([ids.cyRun]);
  });

  it('lists issues with a published position; an empty cell stays empty', async () => {
    const c = await getPublicComparison(db, ids.auditor!);
    expect(c!.issues.map((i) => i.id).sort()).toEqual([issueA.id, issueB.id].sort());
    const [ada, ben] = c!.columns;
    expect(ada!.positions.map((p) => p.title).sort()).toEqual([
      'Backs quarterly ledger reviews',
      'Opposes surplus transfers',
    ]);
    expect(ben!.positions).toEqual([]);
    for (const p of ada!.positions) expect(c!.citations.claim.get(p.id)).toHaveLength(1);
    expect(c!.citations.candidacy.get(`candidacy:${ids.benRun}`)).toBeTruthy();
  });

  it('shows draft entries only in a preview', async () => {
    const c = await getPublicComparison(db, ids.auditor!, [ids.adaRun!], { preview: true });
    expect(c!.columns[0]!.positions.map((p) => p.title)).toContain('Unreviewed zeppelin statement');
  });

  it('returns null for a race that is not public', async () => {
    expect(await getPublicComparison(db, 999_999)).toBeNull();
  });

  it('shows each record from official data and the roll calls they shared', async () => {
    const before = await getPublicComparison(db, ids.auditor!);
    expect(before!.columns[0]!.record.seats).toEqual([]);
    expect(before!.sharedVotes.congress).toEqual([]);

    // Fixture records only: example Bioguide IDs, not real members or roll calls.
    const [src] = await db.insert(schema.source).values({
      url: 'https://clerk.house.example/votes',
      title: 'Roll calls (example)',
      publisher: 'House Clerk (example)',
      sourceType: 'legislative_record',
      retrievedAt: '2026-01-01',
    });
    const sourceId = src.insertId;
    await db.insert(schema.personIdentifier).values([
      { personId: ids.ada!, scheme: 'bioguide', value: 'X000001' },
      { personId: ids.ben!, scheme: 'bioguide', value: 'X000002' },
    ]);
    const seat = { chamber: 'house' as const, state: 'KY', sourceId, sourceUpdatedAt: 'x' };
    await db.insert(schema.congressMembership).values([
      {
        ...seat,
        bioguideId: 'X000001',
        congress: 118,
        district: 3,
        startYear: 2023,
        endYear: 2025,
      },
      { ...seat, bioguideId: 'X000001', congress: 119, district: 3, startYear: 2025 },
    ]);
    const vote = async (
      rollNumber: number,
      day: string,
      publishState: 'published' | 'unpublished' = 'published',
    ) => {
      const [r] = await db.insert(schema.rollCallVote).values({
        chamber: 'house',
        congress: 119,
        session: 1,
        rollNumber,
        votedAt: new Date(`${day}T15:00:00Z`),
        question: `Example question ${rollNumber}`,
        result: 'Passed',
        sourceId,
        sourceUpdatedAt: 'x',
        publishState,
      });
      return r.insertId;
    };
    const both = await vote(1, '2025-03-01');
    const adaOnly = await vote(2, '2025-03-02');
    const hidden = await vote(3, '2025-03-03', 'unpublished');
    await db.insert(schema.votePosition).values([
      { voteId: both, bioguideId: 'X000001', voteCast: 'Yea' },
      { voteId: both, bioguideId: 'X000002', voteCast: 'Nay' },
      { voteId: adaOnly, bioguideId: 'X000001', voteCast: 'Yea' },
      { voteId: hidden, bioguideId: 'X000001', voteCast: 'Yea' },
      { voteId: hidden, bioguideId: 'X000002', voteCast: 'Yea' },
    ]);

    const c = await getPublicComparison(db, ids.auditor!);
    const [ada, ben] = c!.columns;
    expect(ada!.record.seats).toEqual([
      { chamber: 'house', state: 'KY', district: '3', startYear: 2023, endYear: null },
    ]);
    expect(ada!.record.congressVotes).toBe(2);
    expect(ada!.record.bioguideId).toBe('X000001');
    expect(ben!.record.seats).toEqual([]);
    expect(ben!.record.congressVotes).toBe(1);
    // Only the published roll call both of them voted on.
    expect(c!.sharedVotes.congress.map((v) => v.rollNumber)).toEqual([1]);
    const cast = c!.sharedVotes.congress[0]!.cast;
    expect(cast.get(ids.ada!)).toBe('Yea');
    expect(cast.get(ids.ben!)).toBe('Nay');
    // An editor's preview still sees the unpublished one.
    const preview = await getPublicComparison(db, ids.auditor!, [], { preview: true });
    expect(preview!.sharedVotes.congress.map((v) => v.rollNumber)).toEqual([3, 1]);
  });
});

describe('issue pages', () => {
  it('counts candidates in upcoming races with a published position', async () => {
    const list = await listPublicIssues(db);
    expect(list.find((i) => i.id === issueA.id)?.candidates).toBe(2);
    expect(list.find((i) => i.id === issueB.id)?.candidates).toBe(1);
    expect(
      (await listPublicIssues(db, '2028-01-01')).find((i) => i.id === issueA.id)?.candidates,
    ).toBe(0);
  });

  it('groups positions by race and says how many candidates have none', async () => {
    const page = await getPublicIssue(db, issueA.slug);
    expect(page!.races.map((r) => r.raceName)).toEqual(['Example Auditor', 'Example Treasurer']);
    const auditor = page!.races[0]!;
    expect(auditor).toMatchObject({ withPosition: 1, candidateCount: 2 });
    expect(auditor.rows.map((r) => r.title)).toEqual(['Backs quarterly ledger reviews']);
    expect(page!.citations.get(ids.adaPosA!)).toHaveLength(1);
    expect(await getPublicIssue(db, 'no-such-issue')).toBeNull();
  });
});
