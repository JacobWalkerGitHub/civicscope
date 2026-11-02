import { createDb, createPool } from '../client';
import { applyAppGrants } from '../grants';
import { runMigrations } from '../migrate';
import { requireDatabaseUrl, runCli } from './env';

/**
 * Applies migrations as the migration user (DATABASE_URL). When APP_DB_USER is set,
 * it then refreshes the web app's least-privilege account so new tables are covered.
 */
await runCli(async () => {
  const pool = createPool(requireDatabaseUrl());
  try {
    const db = createDb(pool);
    await runMigrations(db);
    console.log('Migrations applied.');
    const user = process.env.APP_DB_USER;
    if (user) {
      await applyAppGrants(db, {
        user,
        host: process.env.APP_DB_HOST || undefined,
        password: process.env.APP_DB_PASSWORD || undefined,
      });
      console.log(`Grants refreshed for app user ${user}.`);
    }
  } finally {
    await pool.end();
  }
});
