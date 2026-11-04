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
  createPerson,
  createRace,
  getCandidacy,
  getElection,
  getPerson,
  getRace,
  publishWithCandidates,
  setCandidacyPublishState,
  setPersonPublishState,
  setPublishState,
} from '../src/index';

const source = {
  sourceUrl: 'https://elect.state.example/candidates',
  sourceTitle: 'Official candidate list',
  sourcePublisher: 'State Board of Elections (example)',
  sourceType: 'official_election_authority',
};

let test: TestDatabase;
let db: Db;
let actor: { userId: number; ipAddress: string };
let electionId: number;
let raceA: number;
let raceB: number;

/** A candidate with a source on the person and a sourced status on the candidacy. */
async function readyCandidate(name: string, raceId: number) {
  const personId = await createPerson(db, actor, { fullName: name });
  await addCitation(db, actor, {
    ...source,
    subjectType: 'person',
    subjectId: String(personId),
  });
  const cid = await createCandidacy(db, actor, {
    personId: String(personId),
    raceId: String(raceId),
  });
  await addStatusEvent(db, actor, cid, { ...source, status: 'filed', effectiveDate: '2026-10-10' });
  await addCitation(db, actor, { ...source, subjectType: 'candidacy', subjectId: String(cid) });
  return { personId, cid };
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email: 'editor@test.local', name: 'Editor', passwordHash: 'x', role: 'owner' });
  actor = { userId: res.insertId, ipAddress: '10.1.1.2' };
  const officeId = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Governor',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const office2 = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Treasurer',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  electionId = await createElection(db, actor, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example general',
  });
  raceA = await createRace(db, actor, { electionId, officeId, name: 'Example Governor' });
  raceB = await createRace(db, actor, {
    electionId,
    officeId: office2,
    name: 'Example Treasurer',
  });
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

describe('publishWithCandidates', () => {
  it('publishes the election, race and ready candidates, and lists the rest', async () => {
    const ready = await readyCandidate('Avery Ready', raceA);
    // No source on the person: skipped, with the reason.
    const bare = await createPerson(db, actor, { fullName: 'Blake Bare' });
    const bareC = await createCandidacy(db, actor, {
      personId: String(bare),
      raceId: String(raceA),
    });
    // Unpublished by an editor on purpose: left alone.
    const held = await readyCandidate('Casey Held', raceA);
    await setPublishState(db, actor, 'election', electionId, 'published');
    await setPublishState(db, actor, 'race', raceA, 'published');
    await setPersonPublishState(db, actor, held.personId, 'published');
    await setCandidacyPublishState(db, actor, held.cid, 'published');
    await setCandidacyPublishState(db, actor, held.cid, 'unpublished');

    const s = await publishWithCandidates(db, actor, { raceId: raceA });
    expect(s).toMatchObject({ elections: 0, races: 0, people: 1, candidacies: 1 });
    expect(s.skipped).toEqual([
      { name: 'Blake Bare (Example Governor)', reason: expect.stringMatching(/source/) },
    ]);
    expect((await getRace(db, raceA)).publishState).toBe('published');
    expect((await getCandidacy(db, ready.cid)).publishState).toBe('published');
    expect((await getCandidacy(db, held.cid)).publishState).toBe('unpublished');
    expect((await getPerson(db, bare)).publishState).toBe('draft');
    expect((await getCandidacy(db, bareC)).publishState).toBe('draft');
    // The other race is untouched when publishing one race.
    expect((await getRace(db, raceB)).publishState).toBe('draft');
  });

  it('publishes every race of an election, and is safe to run again', async () => {
    const other = await readyCandidate('Drew Other', raceB);
    const s = await publishWithCandidates(db, actor, { electionId });
    expect(s).toMatchObject({ races: 1, candidacies: 1 });
    expect((await getElection(db, electionId)).publishState).toBe('published');
    expect((await getCandidacy(db, other.cid)).publishState).toBe('published');
    const again = await publishWithCandidates(db, actor, { electionId });
    expect(again).toMatchObject({ elections: 0, races: 0, people: 0, candidacies: 0 });
    expect(again.skipped).toHaveLength(1);
  });
});
