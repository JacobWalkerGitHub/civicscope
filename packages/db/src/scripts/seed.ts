import { createDb, createPool } from '../client';
import { seedJurisdictions } from '../seed/seed';
import { requireDatabaseUrl } from './env';

const pool = createPool(requireDatabaseUrl());
try {
  const result = await seedJurisdictions(createDb(pool));
  console.log(`Jurisdictions seeded: ${result.inserted} inserted, ${result.updated} updated.`);
} finally {
  await pool.end();
}
