import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  addStatusEvent,
  createCandidacy,
  createElection,
  createOffice,
  createParty,
  createPerson,
  createRace,
  getOfficeTimeline,
  getPublicPerson,
  getPublicRace,
  isUpcomingOffice,
  publishedPersonFor,
  setCandidacyPublishState,
  setPersonPublishState,
  setPublishState,
  updateRace,
  CmsError,
  type Actor,
} from '../src/index';

/** Fixture values only: not real candidates, results or term dates. */
let test: TestDatabase;
let db: Db;
let owner: Actor;
const ids = {} as Record<string, number>;
const TODAY = '2026-11-07';

const official = {
  sourceUrl: 'https://elect.state.example/2026/results',
  sourceTitle: 'Official results (example)',
  sourcePublisher: 'State Division of Elections (example)',
  sourceType: 'official_election_authority',
};

async function race(electionId: number, officeId: number, name: string) {
  const id = await createRace(db, owner, { electionId, officeId, name });
  await setPublishState(db, owner, 'race', id, 'published');
  return id;
}

async function ran(personId: number, raceId: number, status: 'won' | 'lost' | 'advanced') {
  const id = await createCandidacy(db, owner, {
    personId: String(personId),
    raceId: String(raceId),
  });
  await addStatusEvent(db, owner, id, { ...official, status, effectiveDate: '2026-11-05' });
  await setCandidacyPublishState(db, owner, id, 'published');
  return id;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [res] = await db.insert(schema.adminUser).values({
    email: 'owner@test.local',
    name: 'Owner',
    passwordHash: 'x',
    role: 'owner',
  });
  owner = { userId: res.insertId, ipAddress: '10.1.1.9' };
  const [fl] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'FL'));
  const governor = await createOffice(db, owner, {
    jurisdictionId: String(fl!.id),
    title: 'Governor of Example State',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const treasurer = await createOffice(db, owner, {
    jurisdictionId: String(fl!.id),
    title: 'Example Treasurer',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const election = (type: string, date: string, name: string) =>
    createElection(db, owner, {
      jurisdictionId: String(fl!.id),
      type,
      primarySystem: type === 'general' ? 'not_applicable' : 'closed',
      date,
      name,
    });
  ids.primary = await election('primary', '2026-08-18', 'Example primary 2026');
  ids.general = await election('general', '2026-11-03', 'Example general 2026');
  ids.oldGeneral = await election('general', '2022-11-08', 'Example general 2022');
  for (const e of [ids.primary, ids.general, ids.oldGeneral]) {
    await setPublishState(db, owner, 'election', e!, 'published');
  }
  const partyId = await createParty(db, owner, { name: 'Example Party' });
  ids.primaryRace = await createRace(db, owner, {
    electionId: ids.primary,
    officeId: governor,
    partyId: String(partyId),
    name: 'Governor',
  });
  await setPublishState(db, owner, 'race', ids.primaryRace, 'published');
  ids.governorRace = await race(ids.general!, governor, 'Governor');
  ids.treasurerRace = await race(ids.general!, treasurer, 'Example Treasurer');
  ids.oldRace = await race(ids.oldGeneral!, treasurer, 'Example Treasurer');

  // Dee: a sitting U.S. Representative who won the general election for governor.
  ids.dee = await createPerson(db, owner, { fullName: 'Dee Winner' });
  await addCitation(db, owner, { ...official, subjectType: 'person', subjectId: String(ids.dee) });
  await setPersonPublishState(db, owner, ids.dee, 'published');
  await ran(ids.dee, ids.primaryRace, 'won');
  await ran(ids.dee, ids.governorRace, 'won');
  await ran(ids.dee, ids.oldRace, 'won');
  const [src] = await db.insert(schema.source).values({
    url: 'https://www.congress.gov/member/example',
    title: 'Member (example)',
    publisher: 'Congress.gov',
    sourceType: 'government_record',
    retrievedAt: '2026-11-01',
  });
  await db
    .insert(schema.personIdentifier)
    .values({ personId: ids.dee, scheme: 'bioguide', value: 'W000901' });
  const seat = {
    bioguideId: 'W000901',
    chamber: 'house' as const,
    state: 'FL',
    district: 19,
    partyName: 'Example Party',
    sourceId: src.insertId,
    sourceUpdatedAt: 'x',
  };
  await db.insert(schema.congressMembership).values([
    { ...seat, congress: 118, startYear: 2023, endYear: 2025 },
    { ...seat, congress: 119, startYear: 2025 },
  ]);

  // Lou: lost the treasurer race. Nothing is "next" for Lou.
  ids.lou = await createPerson(db, owner, { fullName: 'Lou Lost' });
  await addCitation(db, owner, { ...official, subjectType: 'person', subjectId: String(ids.lou) });
  await setPersonPublishState(db, owner, ids.lou, 'published');
  await ran(ids.lou, ids.treasurerRace, 'lost');
});
afterAll(async () => {
  await test?.stop();
});

describe('isUpcomingOffice', () => {
  const won = {
    status: 'won' as const,
    electionType: 'general' as const,
    electionDate: '2026-11-03',
    termStartsOn: null,
  };
  it('counts a recent general-election win, or one whose recorded start is ahead', () => {
    expect(isUpcomingOffice(won, TODAY)).toBe(true);
    expect(isUpcomingOffice({ ...won, termStartsOn: '2027-01-05' }, TODAY)).toBe(true);
  });
  it('never counts a primary win, a loss, a started term or an old win', () => {
    expect(isUpcomingOffice({ ...won, electionType: 'primary' }, TODAY)).toBe(false);
    expect(isUpcomingOffice({ ...won, status: 'lost' }, TODAY)).toBe(false);
    expect(isUpcomingOffice({ ...won, termStartsOn: '2026-11-07' }, TODAY)).toBe(false);
    expect(isUpcomingOffice({ ...won, electionDate: '2022-11-08' }, TODAY)).toBe(false);
  });
});

describe('office timeline', () => {
  it('shows the seat they hold now and the office they won, without a start date', async () => {
    const t = await getOfficeTimeline(db, ids.dee!, { today: TODAY });
    expect(t.current).toEqual([
      expect.objectContaining({ kind: 'congress', state: 'FL', district: 19, startYear: 2023 }),
    ]);
    expect(t.next).toHaveLength(1);
    expect(t.next[0]).toMatchObject({
      raceId: ids.governorRace,
      officeTitle: 'Governor of Example State',
      termStartsOn: null,
      winSource: { url: official.sourceUrl, publisher: official.sourcePublisher },
    });
    expect(t.elections.map((e) => [e.electionName, e.status])).toEqual([
      ['Example general 2026', 'won'],
      ['Example primary 2026', 'won'],
      ['Example general 2022', 'won'],
    ]);
  });

  it('shows the start date once an editor records it with its source', async () => {
    const values = {
      officeId: String(
        (await db.select().from(schema.race).where(eq(schema.race.id, ids.governorRace!)))[0]!
          .officeId,
      ),
      name: 'Governor',
      status: 'certified',
    };
    await expect(
      updateRace(db, owner, ids.governorRace!, { ...values, termStartsOn: '2027-01-05' }),
    ).rejects.toBeInstanceOf(CmsError);
    await updateRace(db, owner, ids.governorRace!, {
      ...values,
      termStartsOn: '2027-01-05',
      termStartSourceUrl: 'https://constitution.example/article-4',
    });
    const t = await getOfficeTimeline(db, ids.dee!, { today: TODAY });
    expect(t.next[0]).toMatchObject({
      termStartsOn: '2027-01-05',
      termStartSourceUrl: 'https://constitution.example/article-4',
    });
    // Once that day comes, it is no longer "next".
    expect((await getOfficeTimeline(db, ids.dee!, { today: '2027-01-05' })).next).toEqual([]);
    const racePage = await getPublicRace(db, ids.governorRace!);
    expect(racePage?.race.termStartsOn).toBe('2027-01-05');
  });

  it('shows nothing next for a loser, and is part of the public profile', async () => {
    const t = await getOfficeTimeline(db, ids.lou!, { today: TODAY });
    expect(t.current).toEqual([]);
    expect(t.next).toEqual([]);
    expect(t.elections[0]).toMatchObject({ status: 'lost' });
    const [p] = await db.select().from(schema.person).where(eq(schema.person.id, ids.dee!));
    const profile = await getPublicPerson(db, p!.slug);
    expect(profile?.offices.elections).toHaveLength(3);
  });

  it('finds the published person behind a Bioguide ID', async () => {
    expect(await publishedPersonFor(db, 'bioguide', 'W000901')).toBe(ids.dee);
    expect(await publishedPersonFor(db, 'bioguide', 'W000999')).toBeNull();
  });
});
