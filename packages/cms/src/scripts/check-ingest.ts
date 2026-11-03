import { parseArgs } from 'node:util';
import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { findIngestProblems, sendAlert } from '../alerts';

/**
 * Looks for ingest runs that failed recently or have been "running" too long, and
 * raises an alert for each (stderr JSON line, plus ALERT_WEBHOOK_URL if set).
 * Exits with an error when it finds any, so a scheduler marks the job as failed too.
 *   pnpm check:ingest [--hours 2] [--stuck-after 6]
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const { values } = parseArgs({
    options: { hours: { type: 'string' }, 'stuck-after': { type: 'string' } },
  });
  const hours = Number(values.hours ?? 2);
  const stuckAfterHours = Number(values['stuck-after'] ?? 6);
  if (!(hours > 0) || !(stuckAfterHours > 0)) {
    throw new Error('--hours and --stuck-after must be positive numbers.');
  }
  const pool = createPool(url);
  try {
    const problems = await findIngestProblems(createDb(pool), {
      since: new Date(Date.now() - hours * 3_600_000),
      stuckAfterHours,
    });
    for (const p of problems) {
      await sendAlert({
        title:
          p.kind === 'failed'
            ? `${p.source} ingest run failed`
            : `${p.source} ingest run has been running for over ${stuckAfterHours} hours`,
        detail: p.error ?? `Started ${p.startedAt.toISOString()}`,
        source: p.source,
        runId: p.runId,
      });
    }
    console.log(
      problems.length
        ? `${problems.length} ingest problem(s) found; alerts sent.`
        : 'No failed or stuck ingest runs.',
    );
    if (problems.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
});
