import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { createDb, createPool, databaseUrlFromEnv } from '../client';
import { checkRestoredDatabase, compareFingerprints, fingerprintDatabase } from '../verify';
import { loadRootEnv, runCli } from './env';

/**
 * Backup restore drill, step 2: check a restored copy of the database.
 *   pnpm db:verify-restore --target mysql://…restored…
 *   pnpm db:verify-restore --target mysql://…restored… --source mysql://…original…
 *   pnpm db:verify-restore --host <restored endpoint>
 * --host reuses the database name, user and password from the environment (DB_NAME,
 * DB_USER, DB_PASSWORD, DB_TLS), so no password goes on the command line. In AWS the
 * drill runs in the migrate task, which has the schema owner's credentials.
 * Without --source it checks the copy on its own (migrations, key tables, citations)
 * and prints row counts and the newest audit entry, which shows how recent the backup
 * is. With --source it also requires every table to match exactly, which only makes
 * sense when nothing wrote to the source since the backup (a local dump, or a
 * maintenance window). Exits with an error if anything is wrong.
 */
await runCli(async () => {
  loadRootEnv();
  const { values } = parseArgs({
    options: { target: { type: 'string' }, source: { type: 'string' }, host: { type: 'string' } },
  });
  const target =
    values.target ??
    (values.host
      ? databaseUrlFromEnv({ ...process.env, DATABASE_URL: undefined, DB_HOST: values.host })
      : process.env.RESTORE_DATABASE_URL);
  if (!target) {
    throw new Error(
      'Give the restored database: --host <endpoint> (with DB_NAME, DB_USER, DB_PASSWORD set) or --target mysql://user:pass@host/db',
    );
  }
  const targetPool = createPool(target);
  const sourcePool = values.source ? createPool(values.source) : null;
  try {
    const restored = createDb(targetPool);
    const problems = await checkRestoredDatabase(restored);
    const tables = await fingerprintDatabase(restored);
    console.log(`Restored copy: ${tables.length} tables.`);
    for (const t of tables)
      console.log(`  ${t.table.padEnd(32)} ${String(t.rows).padStart(9)} rows`);
    const [[latest]] = (await restored.execute(
      sql`select max(occurred_at) as at from audit_log`,
    )) as unknown as [[{ at: Date | null }]];
    console.log(`Newest audit entry: ${latest?.at ? new Date(latest.at).toISOString() : 'none'}`);
    if (sourcePool) {
      problems.push(
        ...compareFingerprints(await fingerprintDatabase(createDb(sourcePool)), tables),
      );
    }
    if (problems.length) {
      console.error(`Restore check FAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`Restore check passed${sourcePool ? '; every table matches the source' : ''}.`);
    }
  } finally {
    await targetPool.end();
    await sourcePool?.end();
  }
});
