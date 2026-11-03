import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedIssues, seedJurisdictions } from '../src/index';
import { startTestDatabase, type TestDatabase } from '../src/testing';
import { checkRestoredDatabase, compareFingerprints, fingerprintDatabase } from '../src/verify';

/*
 * The backup restore drill, end to end on throwaway databases: dump one MySQL server
 * with mysqldump, load the dump into a fresh server, and check the copy.
 */
let source: TestDatabase;
let restored: TestDatabase;

async function sh(db: TestDatabase, command: string) {
  const res = await db.container.exec(['sh', '-c', command]);
  if (res.exitCode !== 0) throw new Error(`${command}: ${res.output}`);
  return res.stdout;
}

beforeAll(async () => {
  [source, restored] = await Promise.all([startTestDatabase(), startTestDatabase()]);
  await seedJurisdictions(source.db);
  await seedIssues(source.db);
  await source.db.insert(schema.adminUser).values({
    email: 'owner@test.local',
    name: 'Owner',
    passwordHash: 'x',
    role: 'owner',
  });
  const pw = source.container.getRootPassword();
  const name = source.container.getDatabase();
  const dump = await sh(
    source,
    `mysqldump -uroot -p'${pw}' --single-transaction --routines --triggers --set-gtid-purged=OFF ${name} 2>/dev/null`,
  );
  await restored.container.copyContentToContainer([{ content: dump, target: '/tmp/restore.sql' }]);
  await sh(
    restored,
    `mysql -uroot -p'${restored.container.getRootPassword()}' ${restored.container.getDatabase()} < /tmp/restore.sql 2>&1`,
  );
}, 240_000);
afterAll(async () => {
  await Promise.all([source?.stop(), restored?.stop()]);
});

describe('backup restore drill', () => {
  it('restores every table exactly and passes the checks', async () => {
    const differences = compareFingerprints(
      await fingerprintDatabase(source.db),
      await fingerprintDatabase(restored.db),
    );
    expect(differences).toEqual([]);
    expect(await checkRestoredDatabase(restored.db)).toEqual([]);
  });

  it('notices a table that does not match', async () => {
    await restored.db.delete(schema.issue);
    const differences = compareFingerprints(
      await fingerprintDatabase(source.db),
      await fingerprintDatabase(restored.db),
    );
    expect(differences.some((d) => d.startsWith('issue:'))).toBe(true);
  });

  it('flags an empty copy', async () => {
    await restored.db.delete(schema.adminUser);
    expect(await checkRestoredDatabase(restored.db)).toContain('admin_user: missing or empty');
  });
});
