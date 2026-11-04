import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  addPersonIdentifier,
  addStatusEvent,
  CmsError,
  createCandidacy,
  createElection,
  createOffice,
  createParty,
  createPerson,
  createPersonWithCandidacy,
  createRace,
  getCandidacy,
  getPerson,
  listCitations,
  listElections,
  listPeople,
  listSources,
  listPeopleForRace,
  listStatusEvents,
  removeCitation,
  removePersonIdentifier,
  restoreRevision,
  setArchived,
  setCandidacyArchived,
  setCandidacyPublishState,
  setPersonArchived,
  setPersonPublishState,
  setPublishState,
  setSourceArchived,
  updateCandidacy,
  updatePerson,
} from '../src/index';

let test: TestDatabase;
let db: Db;
let actor: { userId: number; ipAddress: string };
let generalRaceId: number;
let primaryRaceId: number;
let partyA: number;
let partyB: number;
let electionId: number;

/** Fixture values for rule tests; not real candidates or real election data. */
const officialSource = {
  sourceUrl: 'https://elect.state.example/candidates#list',
  sourceTitle: 'Official candidate list',
  sourcePublisher: 'State Board of Elections (example)',
  sourceType: 'official_election_authority',
};

async function expectCmsError(promise: Promise<unknown>, match: RegExp, field?: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CmsError);
    const e = error as CmsError;
    expect(e.message + JSON.stringify(e.fieldErrors)).toMatch(match);
    if (field) expect(e.fieldErrors).toHaveProperty(field);
    return;
  }
  throw new Error('Expected a CmsError');
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  const [res] = await db.insert(schema.adminUser).values({
    email: 'editor@test.local',
    name: 'Test Editor',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.1.1.2' };

  partyA = await createParty(db, actor, { name: 'Example Party A' });
  partyB = await createParty(db, actor, { name: 'Example Party B' });
  const officeId = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Governor',
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
  generalRaceId = await createRace(db, actor, {
    electionId,
    officeId,
    name: 'Example Governor',
  });
  const primaryId = await createElection(db, actor, {
    jurisdictionId: String(ky!.id),
    type: 'primary',
    primarySystem: 'closed',
    date: '2027-05-18',
    name: 'Example primary',
  });
  primaryRaceId = await createRace(db, actor, {
    electionId: primaryId,
    officeId,
    partyId: partyA,
    name: 'Example Governor (Party A)',
  });
});
afterAll(async () => {
  await test?.stop();
});

describe('people', () => {
  it('creates a person with a derived sort name and keeps no party on the person', async () => {
    const id = await createPerson(db, actor, { fullName: 'Pat Q. Example Jr.' });
    const p = await getPerson(db, id);
    expect(p.sortName).toBe('Example Jr., Pat Q.');
    expect(p.slug).toBe('pat-q-example-jr');
    expect(p).not.toHaveProperty('partyId');
  });

  it('cannot be published without a source (no citation, no publish)', async () => {
    const id = await createPerson(db, actor, { fullName: 'Sam Unsourced' });
    await expectCmsError(setPersonPublishState(db, actor, id, 'published'), /at least one source/);
    await addCitation(db, actor, {
      ...officialSource,
      subjectType: 'person',
      subjectId: String(id),
      field: 'fullName',
      excerpt: 'Sam Unsourced, Example County',
    });
    await setPersonPublishState(db, actor, id, 'published');
    expect((await getPerson(db, id)).publishState).toBe('published');

    // The last source of a published record can't be removed.
    const [only] = await listCitations(db, 'person', id);
    await expectCmsError(removeCitation(db, actor, only!.id), /only source/);
  });

  it('reuses a known source by URL and needs details only for a new one', async () => {
    const id = await createPerson(db, actor, { fullName: 'Robin Cited' });
    // Same document, different fragment and host case: reused.
    await addCitation(db, actor, {
      sourceUrl: 'https://ELECT.state.example/candidates',
      subjectType: 'person',
      subjectId: String(id),
    });
    const sources = await db.select().from(schema.source);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toBe('https://elect.state.example/candidates');

    await expectCmsError(
      addCitation(db, actor, {
        sourceUrl: 'https://news.example/story',
        subjectType: 'person',
        subjectId: String(id),
      }),
      /not a known source/,
      'sourceTitle',
    );
  });

  it('keeps IDs unique across people and explains a clash', async () => {
    const a = await createPerson(db, actor, { fullName: 'Lee One' });
    const b = await createPerson(db, actor, { fullName: 'Lee Two' });
    const idA = await addPersonIdentifier(db, actor, a, {
      scheme: 'fec_candidate_id',
      value: 'h0ky00001',
    });
    await expectCmsError(
      addPersonIdentifier(db, actor, b, { scheme: 'fec_candidate_id', value: 'H0KY00001' }),
      /already belongs to Lee One/,
      'value',
    );
    await expectCmsError(
      addPersonIdentifier(db, actor, b, { scheme: 'bioguide', value: 'nope' }),
      /Bioguide/,
      'value',
    );
    await removePersonIdentifier(db, actor, idA);
    await addPersonIdentifier(db, actor, b, { scheme: 'fec_candidate_id', value: 'H0KY00001' });
  });

  it('restores an earlier version of a person', async () => {
    const id = await createPerson(db, actor, { fullName: 'Original Name' });
    await updatePerson(db, actor, id, { fullName: 'Changed Name' });
    await restoreRevision(db, actor, 'person', id, 1);
    expect((await getPerson(db, id)).fullName).toBe('Original Name');
  });
});

describe('candidacies', () => {
  it('fills the ballot name from the person, and blocks duplicates', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Morgan Ballot' });
    const cid = await createCandidacy(db, actor, {
      personId: String(pid),
      raceId: String(generalRaceId),
      partyId: String(partyB),
    });
    const c = await getCandidacy(db, cid);
    expect(c.ballotName).toBe('Morgan Ballot');
    expect(c.partyId).toBe(partyB);
    await expectCmsError(
      createCandidacy(db, actor, { personId: String(pid), raceId: String(generalRaceId) }),
      /already a candidate/,
      'personId',
    );
    expect((await listPeopleForRace(db, generalRaceId)).some((p) => p.id === pid)).toBe(false);
  });

  it('adds someone new to a race in one step, or not at all', async () => {
    const { personId, candidacyId } = await createPersonWithCandidacy(db, actor, {
      fullName: 'Riley Newcomer',
      raceId: String(generalRaceId),
      partyId: String(partyA),
    });
    const c = await getCandidacy(db, candidacyId);
    expect(c).toMatchObject({ personId, ballotName: 'Riley Newcomer', partyId: partyA });
    const [p] = await db.select().from(schema.person).where(eq(schema.person.id, personId));
    expect(p).toMatchObject({ sortName: 'Newcomer, Riley', publishState: 'draft' });

    // The primary belongs to party A: party B is refused, and no person is left behind.
    const before = (await db.select().from(schema.person)).length;
    await expectCmsError(
      createPersonWithCandidacy(db, actor, {
        fullName: 'Stray Person',
        raceId: String(primaryRaceId),
        partyId: String(partyB),
      }),
      /primary/,
      'partyId',
    );
    expect((await db.select().from(schema.person)).length).toBe(before);
    await expectCmsError(
      createPersonWithCandidacy(db, actor, { raceId: String(generalRaceId) }),
      /name/i,
      'fullName',
    );
  });

  it('gives primary candidates the primary’s party and refuses another', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Casey Primary' });
    await expectCmsError(
      createCandidacy(db, actor, {
        personId: String(pid),
        raceId: String(primaryRaceId),
        partyId: String(partyB),
      }),
      /primary/,
      'partyId',
    );
    const cid = await createCandidacy(db, actor, {
      personId: String(pid),
      raceId: String(primaryRaceId),
    });
    expect((await getCandidacy(db, cid)).partyId).toBe(partyA);
    await updateCandidacy(db, actor, cid, { partyId: '', ballotName: 'Casey P.' });
    expect((await getCandidacy(db, cid)).partyId).toBe(partyA);
  });

  it('tracks status as dated, sourced, append-only events', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Jordan Status' });
    const cid = await createCandidacy(db, actor, {
      personId: String(pid),
      raceId: String(generalRaceId),
    });
    await addStatusEvent(db, actor, cid, {
      ...officialSource,
      status: 'filed',
      effectiveDate: '2026-01-10',
    });
    // An earlier-dated event recorded later doesn't replace the current status.
    await addStatusEvent(db, actor, cid, {
      ...officialSource,
      status: 'announced',
      effectiveDate: '2025-12-01',
    });
    let c = await getCandidacy(db, cid);
    expect([c.status, c.statusDate]).toEqual(['filed', '2026-01-10']);
    await addStatusEvent(db, actor, cid, {
      ...officialSource,
      status: 'withdrawn',
      effectiveDate: '2026-02-01',
    });
    c = await getCandidacy(db, cid);
    expect(c.status).toBe('withdrawn');
    expect(await listStatusEvents(db, cid)).toHaveLength(3);
    // Each event's source is also a citation on the candidacy's status.
    const cites = await listCitations(db, 'candidacy', cid);
    expect(cites.every((x) => x.field === 'status')).toBe(true);

    await expectCmsError(
      addStatusEvent(db, actor, cid, {
        ...officialSource,
        status: 'won',
        effectiveDate: '2999-11-02',
      }),
      /future/,
      'effectiveDate',
    );
    await expect(
      db.execute(sql`UPDATE candidacy_status_event SET status = 'won'`),
    ).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM candidacy_status_event`)).rejects.toThrow();
  });

  it('publishes only with a published person and race, a status and a source', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Avery Publish' });
    const cid = await createCandidacy(db, actor, {
      personId: String(pid),
      raceId: String(generalRaceId),
    });
    await expectCmsError(setCandidacyPublishState(db, actor, cid, 'published'), /person first/);
    await addCitation(db, actor, {
      ...officialSource,
      subjectType: 'person',
      subjectId: String(pid),
    });
    await setPersonPublishState(db, actor, pid, 'published');
    await expectCmsError(setCandidacyPublishState(db, actor, cid, 'published'), /race first/);
    await setPublishState(db, actor, 'election', electionId, 'published');
    await setPublishState(db, actor, 'race', generalRaceId, 'published');
    await expectCmsError(setCandidacyPublishState(db, actor, cid, 'published'), /status/);
    await addStatusEvent(db, actor, cid, {
      ...officialSource,
      status: 'qualified',
      effectiveDate: '2026-03-01',
    });
    await setCandidacyPublishState(db, actor, cid, 'published');

    // Parents can't be hidden or archived while a public child depends on them.
    await expectCmsError(
      setPublishState(db, actor, 'race', generalRaceId, 'unpublished'),
      /candidates first/,
    );
    await expectCmsError(
      setPublishState(db, actor, 'election', electionId, 'unpublished'),
      /races first/,
    );
    await expectCmsError(setArchived(db, actor, 'race', generalRaceId, true), /candidates first/);
    await expectCmsError(setPersonPublishState(db, actor, pid, 'unpublished'), /candidacies/);
    await expectCmsError(setPersonArchived(db, actor, pid, true), /candidacies first/);

    // A cited source can't be archived out from under its citations.
    const [src] = await db.select().from(schema.source).limit(1);
    await expectCmsError(setSourceArchived(db, actor, src!.id, true), /still cited/);

    await setCandidacyArchived(db, actor, cid, true);
    const archived = await getCandidacy(db, cid);
    expect(archived.publishState).toBe('archived');
    await setCandidacyArchived(db, actor, cid, false);
    expect((await getCandidacy(db, cid)).publishState).toBe('draft');
  });

  it('counts citations, candidacies and races per row in list views', async () => {
    const [src] = await listSources(db);
    const live = await db.select().from(schema.citation);
    expect(Number(src!.citationCount)).toBe(live.filter((c) => !c.deletedAt).length);
    expect(Number(src!.citationCount)).toBeGreaterThan(1);

    const morgan = (await listPeople(db, { query: 'Morgan' }))[0]!;
    expect(Number(morgan.candidacyCount)).toBe(1);
    const nobody = (await listPeople(db, { query: 'Robin Cited' }))[0]!;
    expect(Number(nobody.candidacyCount)).toBe(0);

    const general = (await listElections(db)).find((e) => e.id === electionId)!;
    expect(Number(general.raceCount)).toBe(1);
  });

  it('audits every change with who made it', async () => {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, 'candidacy'));
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.actorId === String(actor.userId) && r.ipAddress)).toBe(true);
  });
});
