import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  addPersonIdentifier,
  CmsError,
  createElection,
  createOffice,
  createPerson,
  createPersonWithCandidacy,
  createRace,
  createCandidacy,
  getPerson,
  identifierOwner,
  listCitations,
  mergedProfileSlug,
  mergePeople,
  previewPersonMerge,
  setPersonArchived,
  setPersonPublishState,
} from '../src/index';

/** Fixture people and records for the merge rules; not real candidates. */
let test: TestDatabase;
let db: Db;
let actor: { userId: number; ipAddress: string };
let raceA: number;
let raceB: number;

const cite = (subjectId: number) =>
  addCitation(db, actor, {
    sourceUrl: `https://elect.state.example/people/${subjectId}`,
    sourceTitle: 'Official candidate list',
    sourcePublisher: 'State Board of Elections (example)',
    sourceType: 'official_election_authority',
    subjectType: 'person',
    subjectId: String(subjectId),
  });

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  const [res] = await db.insert(schema.adminUser).values({
    email: 'merge@test.local',
    name: 'Merge Editor',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.1.1.9' };
  const officeId = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Governor',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const otherOfficeId = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Lieutenant Governor',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const electionId = await createElection(db, actor, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example 2027 general',
  });
  raceA = await createRace(db, actor, { electionId, officeId, name: 'Example race A' });
  raceB = await createRace(db, actor, {
    electionId,
    officeId: otherOfficeId,
    name: 'Example race B',
  });
});
afterAll(async () => {
  await test?.stop();
});

async function expectCmsError(promise: Promise<unknown>, match: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(CmsError);
  await expect(promise).rejects.toThrow(match);
}

describe('merging people', () => {
  it('moves everything onto the kept record, archives the other, and keeps the history', async () => {
    // A candidate entered by hand, published, with a candidacy and a source.
    const { personId: candidate } = await createPersonWithCandidacy(db, actor, {
      fullName: 'Jordan Example',
      raceId: String(raceA),
    });
    await cite(candidate);
    await setPersonPublishState(db, actor, candidate, 'published');
    // The same person created by an import, carrying the Bioguide ID.
    const imported = await createPerson(db, actor, {
      fullName: 'Jordan A. Example',
      birthYear: '1970',
    });
    await cite(imported);
    await addPersonIdentifier(db, actor, imported, { scheme: 'bioguide', value: 'E000999' });

    const preview = await previewPersonMerge(db, candidate, imported);
    expect(preview.problems).toEqual([]);
    expect(preview.result).toMatchObject({
      fullName: 'Jordan Example',
      publishState: 'published',
      filledIn: ['birth year'],
    });
    // A preview changes nothing.
    expect((await identifierOwner(db, 'bioguide', 'E000999'))?.id).toBe(imported);

    await mergePeople(db, actor, candidate, imported);

    expect((await identifierOwner(db, 'bioguide', 'E000999'))?.id).toBe(candidate);
    expect(await listCitations(db, 'person', candidate)).toHaveLength(2);
    expect(await listCitations(db, 'person', imported)).toHaveLength(0);
    const kept = await getPerson(db, candidate);
    expect(kept).toMatchObject({ birthYear: 1970, publishState: 'published', deletedAt: null });
    const gone = await getPerson(db, imported);
    expect(gone.publishState).toBe('archived');
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(candidate);

    // The old address leads to the kept profile.
    expect(await mergedProfileSlug(db, gone.slug)).toBe(kept.slug);
    expect(await mergedProfileSlug(db, kept.slug)).toBeNull();

    // Both records record the merge in their history.
    const merges = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'person'), eq(schema.auditLog.action, 'merge')));
    expect(merges.map((m) => m.entityId).sort()).toEqual(
      [String(candidate), String(imported)].sort(),
    );

    // A merged record can't be restored or merged again.
    await expectCmsError(setPersonArchived(db, actor, imported, false), /merged into/);
    await expectCmsError(mergePeople(db, actor, candidate, imported), /already merged/);
  });

  it('refuses to merge two people running in the same race', async () => {
    const { personId: a } = await createPersonWithCandidacy(db, actor, {
      fullName: 'Casey Twin',
      raceId: String(raceB),
    });
    const { personId: b } = await createPersonWithCandidacy(db, actor, {
      fullName: 'Casey Twin Duplicate',
      raceId: String(raceB),
    });
    const preview = await previewPersonMerge(db, a, b);
    expect(preview.problems.join(' ')).toMatch(/Both records are running in Example race B/);
    await expectCmsError(mergePeople(db, actor, a, b), /Both records are running/);
    expect((await getPerson(db, b)).deletedAt).toBeNull();
  });

  it('moves candidacies in different races and warns about two officeholder IDs', async () => {
    const a = await createPerson(db, actor, { fullName: 'Morgan Example' });
    await addPersonIdentifier(db, actor, a, { scheme: 'openstates', value: 'ocd-person/aaa' });
    const b = await createPerson(db, actor, { fullName: 'Morgan Example' });
    await addPersonIdentifier(db, actor, b, { scheme: 'openstates', value: 'ocd-person/bbb' });
    await createCandidacy(db, actor, { personId: String(b), raceId: String(raceA) });
    const preview = await previewPersonMerge(db, a, b);
    expect(preview.problems).toEqual([]);
    expect(preview.warnings.join(' ')).toMatch(/One person should have only one/);
    await mergePeople(db, actor, a, b);
    const rows = await db.select().from(schema.candidacy).where(eq(schema.candidacy.raceId, raceA));
    expect(rows.find((r) => r.personId === b)).toBeUndefined();
    expect(rows.find((r) => r.personId === a)).toBeDefined();
  });
});
