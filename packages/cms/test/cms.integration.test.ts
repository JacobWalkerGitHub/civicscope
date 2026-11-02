import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  CmsError,
  createElection,
  createOffice,
  createParty,
  createRace,
  getElection,
  getRace,
  listAuditEntries,
  listElections,
  listRaces,
  listRevisions,
  restoreRevision,
  setArchived,
  setPublishState,
  updateElection,
  updateParty,
  updateRace,
} from '../src/index';

let test: TestDatabase;
let db: Db;
let actor: { userId: number; ipAddress: string };
let kyId: number;
let laId: number;

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const states = await db.select().from(schema.jurisdiction);
  kyId = states.find((s) => s.uspsCode === 'KY')!.id;
  laId = states.find((s) => s.uspsCode === 'LA')!.id;
  const [res] = await db.insert(schema.adminUser).values({
    email: 'owner@test.local',
    name: 'Test Owner',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.1.1.1' };
});
afterAll(async () => {
  await test?.stop();
});

/** Fixture values for constraint tests; not real election data. */
const kyGeneral = () => ({
  jurisdictionId: String(kyId),
  type: 'general',
  primarySystem: 'not_applicable',
  date: '2027-11-02',
  name: 'Test Kentucky general',
  officialUrl: 'https://elect.ky.example/',
});

async function expectCmsError(promise: Promise<unknown>, match: RegExp, field?: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CmsError);
    expect((error as CmsError).message + JSON.stringify((error as CmsError).fieldErrors)).toMatch(
      match,
    );
    if (field) expect((error as CmsError).fieldErrors).toHaveProperty(field);
    return;
  }
  throw new Error('Expected a CmsError');
}

describe('parties', () => {
  it('creates with a unique slug, and audits and versions every change', async () => {
    const a = await createParty(db, actor, { name: 'Test Party', fecCode: 'tst' });
    const b = await createParty(db, actor, { name: 'Test Party' });
    const rows = await db.select().from(schema.party);
    expect(rows.map((r) => r.slug).sort()).toEqual(['test-party', 'test-party-2']);
    expect(rows.find((r) => r.id === a)?.fecCode).toBe('TST');

    await updateParty(db, actor, b, { name: 'Other Test Party' });
    const revisions = await listRevisions(db, 'party', b);
    expect(revisions.map((r) => r.version)).toEqual([2, 1]);
    expect(revisions[0]?.authorName).toBe('Test Owner');

    const audit = await listAuditEntries(db, 'party', b);
    expect(audit.map((e) => e.action)).toEqual(['update', 'create']);
    expect(audit[0]?.diff).toMatchObject({ name: ['Test Party', 'Other Test Party'] });
  });

  it('rejects invalid input with field messages and writes nothing', async () => {
    const before = await db.select().from(schema.party);
    await expectCmsError(createParty(db, actor, { name: 'X', fecCode: 'nope!' }), /fix/, 'fecCode');
    expect(await db.select().from(schema.party)).toHaveLength(before.length);
  });
});

describe('elections and races', () => {
  let electionId: number;
  let governorId: number;
  let partyId: number;

  beforeAll(async () => {
    governorId = await createOffice(db, actor, {
      jurisdictionId: String(kyId),
      title: 'Governor of Kentucky',
      level: 'state',
      branch: 'executive',
      termYears: '4',
      isPartisan: 'on',
    });
    [{ id: partyId }] = (await db.select({ id: schema.party.id }).from(schema.party)) as [
      { id: number },
    ];
  });

  it('creates an election and its cycle from the date', async () => {
    electionId = await createElection(db, actor, kyGeneral());
    const row = await getElection(db, electionId);
    expect(row.publishState).toBe('draft');
    const [cycle] = await db
      .select()
      .from(schema.electionCycle)
      .where(eq(schema.electionCycle.id, row.cycleId));
    expect(cycle?.year).toBe(2027);
    expect(await listElections(db, { year: 2027 })).toHaveLength(1);
  });

  it('explains a duplicate election instead of failing with a database error', async () => {
    await expectCmsError(createElection(db, actor, kyGeneral()), /already has an election/, 'date');
  });

  it('creates a race that copies its election type, and refuses a party in a general', async () => {
    await expectCmsError(
      createRace(db, actor, {
        electionId: String(electionId),
        officeId: String(governorId),
        partyId: String(partyId),
        name: 'Governor',
      }),
      /cannot name one/,
      'partyId',
    );
    const raceId = await createRace(db, actor, {
      electionId: String(electionId),
      officeId: String(governorId),
      name: 'Governor',
    });
    const row = await getRace(db, raceId);
    expect(row).toMatchObject({ electionType: 'general', primarySystem: 'not_applicable' });
    await expectCmsError(
      createRace(db, actor, {
        electionId: String(electionId),
        officeId: String(governorId),
        name: 'Governor again',
      }),
      /already has that race/,
    );
  });

  it('locks an election type once it has races, with a plain explanation', async () => {
    await expectCmsError(
      updateElection(db, actor, electionId, {
        ...kyGeneral(),
        type: 'primary',
        primarySystem: 'closed',
      }),
      /already has races/,
      'type',
    );
  });

  it('only publishes a race after its election, and audits publishing', async () => {
    const [raceRow] = await listRaces(db, electionId);
    await expectCmsError(
      setPublishState(db, actor, 'race', raceRow!.id, 'published'),
      /Publish the election first/,
    );
    await setPublishState(db, actor, 'election', electionId, 'published');
    await setPublishState(db, actor, 'race', raceRow!.id, 'published');
    expect((await getRace(db, raceRow!.id)).publishState).toBe('published');

    const audit = await listAuditEntries(db, 'race', raceRow!.id);
    expect(audit[0]).toMatchObject({ action: 'publish', actorName: 'Test Owner' });
  });

  it('archives instead of deleting, and blocks archiving an election with live races', async () => {
    const [raceRow] = await listRaces(db, electionId);
    await expectCmsError(setArchived(db, actor, 'election', electionId, true), /races first/);

    await setArchived(db, actor, 'race', raceRow!.id, true);
    const archived = await getRace(db, raceRow!.id);
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.publishState).toBe('archived');

    // Restoring brings it back as a draft that must be published again.
    await setArchived(db, actor, 'race', raceRow!.id, false);
    expect(await getRace(db, raceRow!.id)).toMatchObject({
      deletedAt: null,
      publishState: 'draft',
    });
  });

  it('restores an earlier version as a new version, keeping the history', async () => {
    const [raceRow] = await listRaces(db, electionId);
    const id = raceRow!.id;
    await updateRace(db, actor, id, { officeId: String(governorId), name: 'Governor (renamed)' });
    const versions = await listRevisions(db, 'race', id);
    const firstVersion = versions.at(-1)!.version;

    await restoreRevision(db, actor, 'race', id, firstVersion);
    expect((await getRace(db, id)).name).toBe('Governor');

    const after = await listRevisions(db, 'race', id);
    expect(after).toHaveLength(versions.length + 1);
    expect(after[0]?.note).toBe(`Restored version ${firstVersion}`);
    const audit = await listAuditEntries(db, 'race', id);
    expect(audit[0]?.action).toBe('restore');
  });

  it('refuses to restore a version that breaks a rule that now applies', async () => {
    // A jungle primary race with no party; then the party rule is checked on restore too.
    const laPrimary = await createElection(db, actor, {
      jurisdictionId: String(laId),
      type: 'primary',
      primarySystem: 'jungle',
      date: '2027-10-09',
      name: 'Test Louisiana primary',
    });
    const laGovernor = await createOffice(db, actor, {
      jurisdictionId: String(laId),
      title: 'Governor of Louisiana',
      level: 'state',
      branch: 'executive',
    });
    const raceId = await createRace(db, actor, {
      electionId: String(laPrimary),
      officeId: String(laGovernor),
      name: 'Governor',
    });
    await setArchived(db, actor, 'election', laPrimary, false); // no-op restore, still draft
    await db
      .update(schema.office)
      .set({ deletedAt: new Date() })
      .where(eq(schema.office.id, laGovernor));
    await expectCmsError(restoreRevision(db, actor, 'race', raceId, 1), /can't be restored/);
  });
});

describe('history tables are append-only', () => {
  it('rejects edits to revisions', async () => {
    await expect(
      db
        .update(schema.revision)
        .set({ note: 'tampered' })
        .where(and(eq(schema.revision.version, 1))),
    ).rejects.toThrow();
    await expect(db.delete(schema.revision)).rejects.toThrow();
  });
});
