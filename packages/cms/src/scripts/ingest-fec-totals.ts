import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertOnFailure } from '../alerts';
import { runFecTotalsImport } from '../fec-totals';

/**
 * Reads the FEC's money totals (raised, spent, cash on hand, debts) for each two-year
 * period given, for every FEC candidate ID on a person running in a CivicScope race.
 *   pnpm ingest:fec-totals 2026 [2028 ...]
 * Needs FEC_API_KEY, like `pnpm ingest:fec`.
 */
await runCli(() =>
  alertOnFailure('FEC totals import failed', async () => {
    const url = requireDatabaseUrl();
    const cycles = process.argv.slice(2).map(Number);
    if (
      cycles.length === 0 ||
      cycles.some((c) => !Number.isInteger(c) || c < 2000 || c > 2100 || c % 2 !== 0)
    ) {
      throw new Error(
        'Give even years for the two-year periods, e.g. `pnpm ingest:fec-totals 2026 2028`.',
      );
    }
    const apiKey = process.env.FEC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'FEC_API_KEY is not set. Get a free key at https://api.data.gov/signup/ and add it to .env.',
      );
    }
    const pool = createPool(url);
    try {
      for (const cycle of cycles) {
        const { runId, summary: s } = await runFecTotalsImport(createDb(pool), cycle, { apiKey });
        console.log(
          `FEC totals ${cycle} (run ${runId}): ${s.candidateIds} candidate IDs, ${s.stored} totals stored, ` +
            `${s.missing} with nothing filed for the period, ${s.requests} requests.`,
        );
      }
    } finally {
      await pool.end();
    }
  }),
);
