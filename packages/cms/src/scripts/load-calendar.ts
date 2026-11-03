import { eq } from 'drizzle-orm';
import { createDb, createPool, schema } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { CALENDAR_2027 } from '../calendar-data/2027';
import { loadCalendar } from '../calendar-load';

/**
 * Loads the reviewed 2027 election calendar (packages/cms/src/calendar-data/2027.ts):
 * elections as drafts, their key dates, and each state's official links. Every change is
 * recorded as the admin you name, who must be allowed to publish.
 *   pnpm data:calendar --as you@example.com
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
    if (user.role !== 'owner' && user.role !== 'reviewer') {
      throw new Error('Loading official links needs permission to publish (owner or reviewer).');
    }
    const s = await loadCalendar(db, { userId: user.id, ipAddress: null }, CALENDAR_2027);
    console.log(
      `2027 calendar (checked ${CALENDAR_2027.checkedOn}): ${s.electionsCreated} elections created (drafts), ` +
        `${s.electionsExisting} already here; ${s.deadlinesCreated} dates added, ${s.deadlinesExisting} already here; ` +
        `${s.resourcesCreated} links added, ${s.resourcesExisting} already here.`,
    );
    for (const d of s.differences) console.log(`  Differs, left as stored: ${d}`);
  } finally {
    await pool.end();
  }
});
