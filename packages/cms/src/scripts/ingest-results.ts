import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertOnFailure } from '../alerts';
import { runResultsIngest } from '../results';

/**
 * Reads the official election-night results files that are live now (see
 * results/feeds.ts) and stores what changed. Runs every five minutes; on a day with no
 * live file it exits at once.
 *   pnpm ingest:results
 */
await runCli(() =>
  alertOnFailure('Live results ingest failed', async () => {
    const pool = createPool(requireDatabaseUrl());
    try {
      const { runId, feeds } = await runResultsIngest(createDb(pool));
      if (runId === null) {
        console.log('No results file is live now.');
        return;
      }
      for (const f of feeds) {
        console.log(
          `${f.state} ${f.electionDate}: ${f.outcome}` +
            (f.contests !== undefined ? ` (${f.contests} contests)` : '') +
            (f.error ? ` - ${f.error}` : ''),
        );
      }
      // A failed read is recorded on the run, and the hourly check alerts on it.
    } finally {
      await pool.end();
    }
  }),
);
