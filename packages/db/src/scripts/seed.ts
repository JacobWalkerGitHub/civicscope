import { createDb, createPool } from '../client';
import { seedIssues } from '../seed/issues';
import { seedJurisdictions } from '../seed/seed';
import { requireDatabaseUrl, runCli } from './env';

await runCli(async () => {
  const pool = createPool(requireDatabaseUrl());
  try {
    const result = await seedJurisdictions(createDb(pool));
    console.log(`Jurisdictions seeded: ${result.inserted} inserted, ${result.updated} updated.`);
    const issues = await seedIssues(createDb(pool));
    console.log(`Issues seeded: ${issues.inserted} added.`);
  } finally {
    await pool.end();
  }
});
