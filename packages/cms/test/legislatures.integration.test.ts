import { and, count, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import { createElection, loadLegislatures, LEGISLATURES_2027, type Actor } from '../src/index';

let test: TestDatabase;
let db: Db;
let owner: Actor;

const stateId = async (code: string) =>
  (
    await db
      .select({ id: schema.jurisdiction.id })
      .from(schema.jurisdiction)
      .where(eq(schema.jurisdiction.uspsCode, code))
  )[0]!.id;

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email: 'owner@test.local', name: 'Owner', passwordHash: 'x', role: 'owner' });
  owner = { userId: res.insertId, ipAddress: null };
  // Fixture elections: a partisan primary in VA and a jungle primary in LA.
  await createElection(db, owner, {
    jurisdictionId: String(await stateId('VA')),
    type: 'primary',
    primarySystem: 'open_partisan',
    date: '2027-06-15',
    name: 'Example VA primary',
  });
  await createElection(db, owner, {
    jurisdictionId: String(await stateId('LA')),
    type: 'primary',
    primarySystem: 'jungle',
    date: '2027-10-09',
    name: 'Example LA primary',
  });
}, 120_000);

afterAll(async () => {
  await test?.stop();
});

describe('loadLegislatures', () => {
  it('creates chambers, districts and draft races, and is safe to run again', async () => {
    const first = await loadLegislatures(db, owner, LEGISLATURES_2027);
    expect(first.officesCreated).toBe(8);
    expect(first.districtsCreated).toBe(40 + 100 + 40 + 40 + 39 + 105 + 52 + 122);
    // VA: one race per major party in each of 140 districts. LA: one per district.
    expect(first.racesCreated).toBe(140 * 2 + 144);
    expect(first.statesWithoutElections.sort()).toEqual(['MS', 'NJ']);

    const again = await loadLegislatures(db, owner, LEGISLATURES_2027);
    expect(again).toMatchObject({ officesCreated: 0, districtsCreated: 0, racesCreated: 0 });
    expect(again.racesExisting).toBe(first.racesCreated);
  }, 300_000);

  it('gives each race its district, party where the primary needs one, and draft state', async () => {
    const [assembly] = await db
      .select()
      .from(schema.office)
      .where(eq(schema.office.title, 'New Jersey General Assembly'));
    expect(assembly).toMatchObject({ seats: 2, chamber: 'lower', termYears: 2 });

    const races = await db.select().from(schema.race);
    expect(races.every((r) => r.publishState === 'draft' && r.districtId !== null)).toBe(true);
    const va = races.filter((r) => r.name.startsWith('Virginia House of Delegates, District 12 '));
    expect(va.map((r) => r.name).sort()).toEqual([
      'Virginia House of Delegates, District 12 (Democratic primary)',
      'Virginia House of Delegates, District 12 (Republican primary)',
    ]);
    const [partyless] = await db
      .select({ n: count() })
      .from(schema.race)
      .where(and(eq(schema.race.primarySystem, 'jungle'), isNotNull(schema.race.partyId)));
    expect(partyless!.n).toBe(0);

    const [d] = await db
      .select()
      .from(schema.district)
      .where(eq(schema.district.ocdId, 'ocd-division/country:us/state:ms/sldu:52'));
    expect(d).toMatchObject({ type: 'state_upper', label: '52', validFrom: '2027-01-01' });
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityType, 'district'),
          eq(schema.auditLog.entityId, String(d!.id)),
        ),
      );
    expect(audits).toHaveLength(1);
  });
});
