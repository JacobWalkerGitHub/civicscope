import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertsConfigFromEnv } from '../email';
import { sendFollowAlerts } from '../follow-alerts';

/**
 * Emails each confirmed follower what was added since their last email, and deletes
 * follow requests never confirmed within 7 days. Daily in AWS, after the imports.
 *   pnpm alerts:send
 * Needs SITE_URL and ALERTS_FROM_EMAIL in production; in development it prints the
 * emails instead of sending them.
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const alerts = alertsConfigFromEnv();
  if (!alerts) {
    console.log('Email alerts are off (ALERTS_FROM_EMAIL or SITE_URL is not set). Nothing sent.');
    return;
  }
  const pool = createPool(url);
  try {
    const s = await sendFollowAlerts(createDb(pool), alerts);
    console.log(
      `${s.follows} confirmed follow(s); ${s.emailsSent} email(s) sent, ${s.emailsFailed} failed; ${s.purged} unconfirmed request(s) deleted.`,
    );
    if (s.emailsFailed) process.exitCode = 1;
  } finally {
    await pool.end();
  }
});
