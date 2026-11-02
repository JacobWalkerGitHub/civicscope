import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, type Db } from '../src/client';
import { runMigrations } from '../src/migrate';
import {
  auditLog,
  election,
  electionCycle,
  jurisdiction,
  office,
  party,
  race,
} from '../src/schema/index';
import { seedJurisdictions } from '../src/seed/seed';

let container: StartedMySqlContainer;
let pool: Pool;
let db: Db;

beforeAll(async () => {
  // Matches production: RDS needs log_bin_trust_function_creators=1 in its parameter
  // group so the (non-SUPER) migration user can create the audit-log triggers.
  container = await new MySqlContainer('mysql:8.4')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .start();
  pool = createPool(container.getConnectionUri());
  db = createDb(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

/** Runs a statement and returns the MySQL error message it fails with. */
async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as { cause?: { message?: string }; message: string };
    return e.cause?.message ?? e.message;
  }
  throw new Error('Expected the statement to fail, but it succeeded');
}

describe('migrations', () => {
  it('apply cleanly to an empty database', async () => {
    await runMigrations(db);
    const [rows] = await pool.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name <> '__drizzle_migrations'
       ORDER BY table_name`,
    );
    expect((rows as { name: string }[]).map((r) => r.name)).toEqual([
      'audit_log',
      'district',
      'election',
      'election_cycle',
      'election_deadline',
      'jurisdiction',
      'office',
      'official_resource',
      'party',
      'race',
    ]);
  });

  it('are idempotent when run again', async () => {
    await expect(runMigrations(db)).resolves.toBeUndefined();
  });
});

describe('jurisdiction seed', () => {
  it('loads the country, 50 states and DC', async () => {
    const result = await seedJurisdictions(db);
    expect(result).toEqual({ inserted: 52, updated: 0 });

    const rows = await db.select().from(jurisdiction);
    expect(rows).toHaveLength(52);
    expect(rows.filter((r) => r.type === 'state')).toHaveLength(50);

    const [dc] = rows.filter((r) => r.uspsCode === 'DC');
    expect(dc).toMatchObject({
      type: 'federal_district',
      fips: '11',
      ocdId: 'ocd-division/country:us/district:dc',
    });

    const [ky] = rows.filter((r) => r.uspsCode === 'KY');
    const [us] = rows.filter((r) => r.type === 'country');
    expect(ky).toMatchObject({ fips: '21', ocdId: 'ocd-division/country:us/state:ky' });
    expect(ky?.parentId).toBe(us?.id);
  });

  it('is idempotent and writes no new audit entries on a re-run', async () => {
    const before = await db.select({ n: sql<number>`count(*)` }).from(auditLog);
    expect(await seedJurisdictions(db)).toEqual({ inserted: 0, updated: 0 });
    const after = await db.select({ n: sql<number>`count(*)` }).from(auditLog);
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));
    expect(Number(before[0]?.n)).toBe(52);
  });

  it('repairs a drifted row and audits the change', async () => {
    await db.update(jurisdiction).set({ name: 'Kentuky' }).where(eq(jurisdiction.uspsCode, 'KY'));
    expect(await seedJurisdictions(db)).toEqual({ inserted: 0, updated: 1 });
    const [ky] = await db.select().from(jurisdiction).where(eq(jurisdiction.uspsCode, 'KY'));
    expect(ky?.name).toBe('Kentucky');
  });

  it('rejects a second root (non-country without a parent)', async () => {
    const msg = await failureOf(
      db.insert(jurisdiction).values({ type: 'state', name: 'Orphan', ocdId: 'ocd-division/x' }),
    );
    expect(msg).toMatch(/jurisdiction_root_is_country/);
  });
});

describe('elections and races', () => {
  let kyId: number;
  let laId: number;
  let cycleId: number;
  let governorKy: number;
  let governorLa: number;
  let demId: number;
  let kyPrimary: number;
  let kyGeneral: number;
  let laPrimary: number;

  beforeAll(async () => {
    const states = await db.select().from(jurisdiction);
    kyId = states.find((s) => s.uspsCode === 'KY')!.id;
    laId = states.find((s) => s.uspsCode === 'LA')!.id;

    // Fixture rows for constraint tests only; not real candidate or election data.
    cycleId = (await db.insert(electionCycle).values({ year: 2027, label: '2027' }))[0].insertId;
    governorKy = (
      await db.insert(office).values({
        jurisdictionId: kyId,
        slug: 'ky-governor',
        title: 'Governor of Kentucky',
        level: 'state',
        branch: 'executive',
        termYears: 4,
      })
    )[0].insertId;
    governorLa = (
      await db.insert(office).values({
        jurisdictionId: laId,
        slug: 'la-governor',
        title: 'Governor of Louisiana',
        level: 'state',
        branch: 'executive',
        termYears: 4,
      })
    )[0].insertId;
    demId = (
      await db.insert(party).values({ slug: 'test-party', name: 'Test Party', fecCode: 'TST' })
    )[0].insertId;

    const mk = async (
      jurisdictionId: number,
      type: typeof election.$inferInsert.type,
      primarySystem: typeof election.$inferInsert.primarySystem,
      date: string,
    ) =>
      (
        await db.insert(election).values({
          cycleId,
          jurisdictionId,
          type,
          primarySystem,
          date,
          name: `Test ${type} ${date}`,
        })
      )[0].insertId;

    kyPrimary = await mk(kyId, 'primary', 'closed', '2027-05-18');
    kyGeneral = await mk(kyId, 'general', 'not_applicable', '2027-11-02');
    laPrimary = await mk(laId, 'primary', 'jungle', '2027-10-09');
  });

  it('rejects an election whose primary system does not fit its type', async () => {
    const general = await failureOf(
      db.insert(election).values({
        cycleId,
        jurisdictionId: kyId,
        type: 'general',
        primarySystem: 'closed',
        date: '2027-11-03',
        name: 'Bad general',
      }),
    );
    expect(general).toMatch(/election_primary_system_matches_type/);

    const primary = await failureOf(
      db.insert(election).values({
        cycleId,
        jurisdictionId: kyId,
        type: 'primary',
        primarySystem: 'not_applicable',
        date: '2027-05-19',
        name: 'Bad primary',
      }),
    );
    expect(primary).toMatch(/election_primary_system_matches_type/);
  });

  it('accepts a closed-primary race that names a party', async () => {
    await db.insert(race).values({
      electionId: kyPrimary,
      electionType: 'primary',
      primarySystem: 'closed',
      officeId: governorKy,
      partyId: demId,
      name: 'Governor (Test Party primary)',
    });
    const rows = await db.select().from(race).where(eq(race.electionId, kyPrimary));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.publishState).toBe('draft');
  });

  it('requires a party in a closed primary', async () => {
    const msg = await failureOf(
      db.insert(race).values({
        electionId: kyPrimary,
        electionType: 'primary',
        primarySystem: 'closed',
        officeId: governorKy,
        name: 'Governor (no party)',
      }),
    );
    expect(msg).toMatch(/race_party_rule/);
  });

  it('forbids a party in a general election race', async () => {
    const msg = await failureOf(
      db.insert(race).values({
        electionId: kyGeneral,
        electionType: 'general',
        primarySystem: 'not_applicable',
        officeId: governorKy,
        partyId: demId,
        name: 'Governor (general, with party)',
      }),
    );
    expect(msg).toMatch(/race_party_rule/);
  });

  it('forbids a party in a jungle primary race and accepts one without', async () => {
    const msg = await failureOf(
      db.insert(race).values({
        electionId: laPrimary,
        electionType: 'primary',
        primarySystem: 'jungle',
        officeId: governorLa,
        partyId: demId,
        name: 'Governor (jungle, with party)',
      }),
    );
    expect(msg).toMatch(/race_party_rule/);

    await db.insert(race).values({
      electionId: laPrimary,
      electionType: 'primary',
      primarySystem: 'jungle',
      officeId: governorLa,
      name: 'Governor (jungle primary)',
    });
  });

  it('rejects a race whose copied election type does not match its election', async () => {
    // Claiming the KY closed primary is a general election would bypass the party rule.
    const msg = await failureOf(
      db.insert(race).values({
        electionId: kyPrimary,
        electionType: 'general',
        primarySystem: 'not_applicable',
        officeId: governorKy,
        name: 'Governor (mislabelled)',
      }),
    );
    expect(msg).toMatch(/race_election_fk|foreign key constraint fails/i);
  });

  it('rejects a race that references a missing election or office', async () => {
    const missingElection = await failureOf(
      db.insert(race).values({
        electionId: 999_999,
        electionType: 'general',
        primarySystem: 'not_applicable',
        officeId: governorKy,
        name: 'Orphan race',
      }),
    );
    expect(missingElection).toMatch(/foreign key constraint fails/i);

    const missingOffice = await failureOf(
      db.insert(race).values({
        electionId: kyGeneral,
        electionType: 'general',
        primarySystem: 'not_applicable',
        officeId: 999_999,
        name: 'Orphan race',
      }),
    );
    expect(missingOffice).toMatch(/foreign key constraint fails/i);
  });

  it('rejects a duplicate statewide race even though district and party are NULL', async () => {
    const values = {
      electionId: kyGeneral,
      electionType: 'general' as const,
      primarySystem: 'not_applicable' as const,
      officeId: governorKy,
      name: 'Governor',
    };
    await db.insert(race).values(values);
    const msg = await failureOf(db.insert(race).values({ ...values, name: 'Governor again' }));
    expect(msg).toMatch(/Duplicate entry .* for key 'race.race_contest_uq'/);

    // A special election for the same office on the same day is a different contest.
    await db.insert(race).values({ ...values, isSpecial: true, name: 'Governor (special)' });
  });

  it('prevents changing an election type once races depend on it', async () => {
    const msg = await failureOf(
      db
        .update(election)
        .set({ type: 'general', primarySystem: 'not_applicable' })
        .where(eq(election.id, laPrimary)),
    );
    expect(msg).toMatch(/foreign key constraint fails/i);
  });
});

describe('audit log', () => {
  it('rejects UPDATE', async () => {
    const msg = await failureOf(db.update(auditLog).set({ note: 'rewritten' }));
    expect(msg).toMatch(/append-only/);
  });

  it('rejects DELETE', async () => {
    const msg = await failureOf(db.delete(auditLog));
    expect(msg).toMatch(/append-only/);
  });
});
