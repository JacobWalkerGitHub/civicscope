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
  createParty,
  createPerson,
  createRace,
  getPublicPerson,
  getPublicRace,
  directoryFilterOptions,
  listPublicCandidates,
  listUpcomingPublicRaces,
  setCandidacyArchived,
  setCandidacyPublishState,
  setClaimArchived,
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
const slugs = {} as Record<string, string>;

const official = {
  sourceUrl: 'https://elect.state.example/2027/list',
  sourceTitle: 'Candidate list (example)',
  sourcePublisher: 'State Board of Elections (example)',
  sourceType: 'official_election_authority',
};

async function cite(type: 'person' | 'candidacy' | 'claim', id: number, field?: string) {
  await addCitation(db, owner, { ...official, subjectType: type, subjectId: String(id), field });
}

async function publishedPerson(name: string) {
  const id = await createPerson(db, owner, { fullName: name });
  await cite('person', id, 'fullName');
  await setPersonPublishState(db, owner, id, 'published');
  return id;
}

async function candidacy(personId: number, raceId: number, publish: boolean) {
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
  owner = { userId: res.insertId, ipAddress: '10.1.1.4' };
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  const [issue] = await db.select().from(schema.issue).limit(1);
  const partyId = await createParty(db, owner, { name: 'Example Party' });
  const officeId = await createOffice(db, owner, {
    jurisdictionId: String(ky!.id),
    title: 'Example Auditor',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });

  // A public election and race, and a draft election with its own race.
  ids.election = await createElection(db, owner, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example general 2027',
  });
  ids.race = await createRace(db, owner, {
    electionId: ids.election,
    officeId,
    name: 'Example Auditor',
  });
  await setPublishState(db, owner, 'election', ids.election, 'published');
  await setPublishState(db, owner, 'race', ids.race, 'published');
  ids.draftElection = await createElection(db, owner, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2028-11-07',
    name: 'Example general 2028 (draft)',
  });
  ids.draftRace = await createRace(db, owner, {
    electionId: ids.draftElection,
    officeId,
    name: 'Example Auditor 2028',
  });

  // Ada: public, with a public candidacy, a draft candidacy in the draft race,
  // one published entry and one draft entry.
  ids.ada = await publishedPerson('Ada Visible');
  ids.adaCandidacy = await candidacy(ids.ada, ids.race, true);
  await candidacy(ids.ada, ids.draftRace, false);
  await db
    .update(schema.candidacy)
    .set({ partyId })
    .where(eq(schema.candidacy.id, ids.adaCandidacy));
  ids.publishedClaim = await createClaim(db, owner, {
    personId: String(ids.ada),
    kind: 'position',
    contentKind: 'candidate_claim',
    title: 'Supports an example audit schedule',
    summary: 'Says audits should happen every year.',
    quote: 'Every agency, every year.',
    issueId: String(issue!.id),
    positionType: 'stated_position',
  });
  await cite('claim', ids.publishedClaim);
  await submitClaimForReview(db, owner, ids.publishedClaim);
  await approveClaim(db, owner, ids.publishedClaim, 'Checked');
  ids.draftClaim = await createClaim(db, owner, {
    personId: String(ids.ada),
    kind: 'biography',
    contentKind: 'sourced_fact',
    title: 'Draft biography entry',
    summary: 'Not reviewed yet.',
    bioCategory: 'education',
  });

  // Bea: a draft person with a draft candidacy in the public race.
  ids.bea = await createPerson(db, owner, { fullName: 'Bea Draft' });
  await cite('person', ids.bea);
  ids.beaCandidacy = await candidacy(ids.bea, ids.race, false);

  // Cal: public person, but the candidacy is still a draft.
  ids.cal = await publishedPerson('Cal Pending');
  ids.calCandidacy = await candidacy(ids.cal, ids.race, false);

  for (const key of ['ada', 'bea', 'cal']) {
    const [p] = await db.select().from(schema.person).where(eq(schema.person.id, ids[key]!));
    slugs[key] = p!.slug;
  }
});
afterAll(async () => {
  await test?.stop();
});

describe('public candidate profile', () => {
  it('shows a published person with only their public candidacies and entries', async () => {
    const profile = await getPublicPerson(db, slugs.ada!);
    expect(profile?.person.fullName).toBe('Ada Visible');
    expect(profile!.candidacies.map((c) => c.raceName)).toEqual(['Example Auditor']);
    expect(profile!.candidacies[0]).toMatchObject({ status: 'filed', partyName: 'Example Party' });
    expect(profile!.claims.map((c) => c.title)).toEqual(['Supports an example audit schedule']);
    expect(profile!.claims[0]!.issueName).toBeTruthy();
    expect(profile!.citations.get(`person:${ids.ada}`)?.[0]).toMatchObject({
      field: 'fullName',
      url: official.sourceUrl,
    });
    expect(profile!.citations.get(`claim:${ids.publishedClaim}`)).toHaveLength(1);
    expect(profile!.citations.get(`candidacy:${ids.adaCandidacy}`)?.[0]?.field).toBe('status');
  });

  it('never returns a draft person', async () => {
    expect(await getPublicPerson(db, slugs.bea!)).toBeNull();
    expect(await getPublicPerson(db, 'no-such-person')).toBeNull();
  });

  it('shows drafts to an admin preview, marked by their publish state', async () => {
    const draft = await getPublicPerson(db, slugs.bea!, { preview: true });
    expect(draft?.person.publishState).toBe('draft');
    const ada = await getPublicPerson(db, slugs.ada!, { preview: true });
    expect(ada!.candidacies.map((c) => c.raceName).sort()).toEqual([
      'Example Auditor',
      'Example Auditor 2028',
    ]);
    expect(ada!.claims.map((c) => c.publishState).sort()).toEqual(['draft', 'published']);
  });
});

describe('public race page', () => {
  it('lists only public candidates whose person is public too', async () => {
    const page = await getPublicRace(db, ids.race!);
    expect(page?.race).toMatchObject({ name: 'Example Auditor', jurisdictionName: 'Kentucky' });
    expect(page!.candidates.map((c) => c.ballotName)).toEqual(['Ada Visible']);
    const preview = await getPublicRace(db, ids.race!, { preview: true });
    // Alphabetical by last name, the neutral order used on every race page.
    expect(preview!.candidates.map((c) => c.ballotName)).toEqual([
      'Bea Draft',
      'Cal Pending',
      'Ada Visible',
    ]);
  });

  it('hides a race whose election is not public', async () => {
    expect(await getPublicRace(db, ids.draftRace!)).toBeNull();
    expect(await getPublicRace(db, ids.draftRace!, { preview: true })).not.toBeNull();
  });

  it('lists upcoming public races with public candidate counts', async () => {
    const races = await listUpcomingPublicRaces(db, '2026-11-02');
    expect(races.map((r) => [r.name, Number(r.candidateCount)])).toEqual([['Example Auditor', 1]]);
    expect(await listUpcomingPublicRaces(db, '2027-11-03')).toEqual([]);
  });
});

describe('candidate directory', () => {
  it('lists public candidacies only, and filters by name, state, level and party', async () => {
    const all = await listPublicCandidates(db, {}, 1, '2026-11-02');
    expect(all.rows.map((r) => r.ballotName)).toEqual(['Ada Visible']);
    expect(all.total).toBe(1);
    expect(all.rows[0]).toMatchObject({
      raceName: 'Example Auditor',
      jurisdictionName: 'Kentucky',
    });

    const [ky] = await db
      .select()
      .from(schema.jurisdiction)
      .where(eq(schema.jurisdiction.uspsCode, 'KY'));
    const [tn] = await db
      .select()
      .from(schema.jurisdiction)
      .where(eq(schema.jurisdiction.uspsCode, 'TN'));
    const count = async (f: Parameters<typeof listPublicCandidates>[1]) =>
      (await listPublicCandidates(db, f, 1, '2026-11-02')).total;
    expect(await count({ q: 'ada' })).toBe(1);
    expect(await count({ q: 'bea' })).toBe(0);
    expect(await count({ q: "%' or 1=1 --" })).toBe(0);
    expect(await count({ jurisdictionId: ky!.id })).toBe(1);
    expect(await count({ jurisdictionId: tn!.id })).toBe(0);
    expect(await count({ level: 'state' })).toBe(1);
    expect(await count({ level: 'federal' })).toBe(0);
    expect((await listPublicCandidates(db, {}, 1, '2028-01-01')).total).toBe(0);
    expect((await listPublicCandidates(db, { includePast: true }, 1, '2028-01-01')).total).toBe(1);

    const options = await directoryFilterOptions(db);
    expect(options.states.map((s) => s.name)).toEqual(['Kentucky']);
    expect(options.parties.map((p) => p.name)).toEqual(['Example Party']);
  });
});

describe('unpublishing and archiving', () => {
  it('removes records from public results immediately', async () => {
    await setCandidacyPublishState(db, owner, ids.calCandidacy!, 'published');
    expect((await getPublicRace(db, ids.race!))!.candidates).toHaveLength(2);

    await setCandidacyPublishState(db, owner, ids.calCandidacy!, 'unpublished');
    expect((await getPublicRace(db, ids.race!))!.candidates).toHaveLength(1);
    expect((await getPublicPerson(db, slugs.cal!))!.candidacies).toEqual([]);

    await setClaimArchived(db, owner, ids.draftClaim!, true);
    const preview = await getPublicPerson(db, slugs.ada!, { preview: true });
    expect(preview!.claims.map((c) => c.title)).not.toContain('Draft biography entry');

    await setCandidacyArchived(db, owner, ids.calCandidacy!, true);
    expect((await getPublicRace(db, ids.race!, { preview: true }))!.candidates).toHaveLength(2);
  });

  it('hides everything under an election that is unpublished', async () => {
    await setCandidacyPublishState(db, owner, ids.adaCandidacy!, 'unpublished');
    await setPublishState(db, owner, 'race', ids.race!, 'unpublished');
    await setPublishState(db, owner, 'election', ids.election!, 'unpublished');
    expect(await getPublicRace(db, ids.race!)).toBeNull();
    expect((await getPublicPerson(db, slugs.ada!))!.candidacies).toEqual([]);
    expect(await listUpcomingPublicRaces(db, '2026-11-02')).toEqual([]);
  });
});
