import { createDb, createPool } from '../client';
import { runMigrations } from '../migrate';
import { requireDatabaseUrl, runCli } from './env';

await runCli(async () => {
  const pool = createPool(requireDatabaseUrl());
  try {
    await runMigrations(createDb(pool));
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
});
