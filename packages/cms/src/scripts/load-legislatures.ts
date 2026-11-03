import { eq } from 'drizzle-orm';
import { createDb, createPool, schema } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { LEGISLATURES_2027 } from '../legislature-data/2027';
import { loadLegislatures } from '../legislature-load';

/**
 * Loads the reviewed 2027 legislatures (packages/cms/src/legislature-data/2027.ts):
 * one office per chamber, its districts, and a draft race in every district for each
 * 2027 election already loaded for that state. Run it again after adding elections.
 *   pnpm data:legislatures --as you@example.com
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const i = process.argv.indexOf('--as');
  const email = i > -1 ? process.argv[i + 1] : undefined;
  if (!email) throw new Error('Say whose name the changes go under: --as you@example.com');
  const pool = createPool(url);
  try {
    const db = createDb(pool);
    const [user] = await db
      .select()
      .from(schema.adminUser)
      .where(eq(schema.adminUser.email, email.toLowerCase()));
    if (!user || user.disabledAt) throw new Error(`No active admin with the email ${email}.`);
    if (user.role === 'viewer') throw new Error('Viewers cannot create records.');
    const s = await loadLegislatures(db, { userId: user.id, ipAddress: null }, LEGISLATURES_2027);
    console.log(
      `2027 legislatures (checked ${LEGISLATURES_2027.checkedOn}): ` +
        `${s.officesCreated} offices created, ${s.officesExisting} already here; ` +
        `${s.districtsCreated} districts created, ${s.districtsExisting} already here; ` +
        `${s.racesCreated} races created (drafts), ${s.racesExisting} already here.`,
    );
    if (s.statesWithoutElections.length > 0) {
      console.log(
        `  No 2027 elections yet for ${s.statesWithoutElections.join(', ')}: add them, then run this again to create their races.`,
      );
    }
    for (const d of s.differences) console.log(`  Differs, left as stored: ${d}`);
  } finally {
    await pool.end();
  }
});
