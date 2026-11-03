import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertOnFailure } from '../alerts';
import { runFecImport } from '../fec-import';

/**
 * Imports one election year's FEC candidate registrations.
 *   pnpm ingest:fec 2028
 * Needs FEC_API_KEY (a free api.data.gov key); DEMO_KEY works for a small test only.
 */
await runCli(() =>
  alertOnFailure('FEC import failed', async () => {
    const url = requireDatabaseUrl();
    const cycle = Number(process.argv[2]);
    if (!Number.isInteger(cycle) || cycle < 2000 || cycle > 2100 || cycle % 2 !== 0) {
      throw new Error('Give an even election year, e.g. `pnpm ingest:fec 2028`.');
    }
    const apiKey = process.env.FEC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'FEC_API_KEY is not set. Get a free key at https://api.data.gov/signup/ and add it to .env.',
      );
    }
    const pool = createPool(url);
    try {
      const { runId, summary } = await runFecImport(createDb(pool), cycle, { apiKey });
      const c = summary.counts;
      console.log(
        `FEC ${cycle} import (run ${runId}): ${summary.fetched} registrations fetched, ` +
          `${c.create} new, ${c.add_to_race} added to a race, ${c.update} updated, ` +
          `${c.unchanged} unchanged, ${c.conflicts} conflicts, ${summary.attention.length} need a person.`,
      );
      if (summary.unknownPartyCodes.length) {
        console.log(
          `Party codes with no matching party (add them on the Parties page): ${summary.unknownPartyCodes.join(', ')}`,
        );
      }
    } finally {
      await pool.end();
    }
  }),
);
