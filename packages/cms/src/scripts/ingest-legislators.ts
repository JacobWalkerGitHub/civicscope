import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { CROSSWALK_DEFAULT_SINCE, runLegislatorCrosswalk } from '../congress-crosswalk';

/**
 * Matches Members of Congress to CivicScope people (Bioguide, FEC and Wikidata IDs)
 * from unitedstates/congress-legislators. No key needed.
 *   pnpm ingest:legislators [--since 2023-01-03]
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const i = process.argv.indexOf('--since');
  const since = i > -1 ? process.argv[i + 1] : CROSSWALK_DEFAULT_SINCE;
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error('Give --since as a date, e.g. --since 2023-01-03.');
  }
  const pool = createPool(url);
  try {
    const { runId, summary: s } = await runLegislatorCrosswalk(createDb(pool), { since });
    console.log(
      `Legislator crosswalk (run ${runId}): ${s.considered} members in scope, ${s.created} new people, ` +
        `${s.linked} existing people linked (${s.identifiersAdded} IDs added), ${s.unchanged} unchanged, ` +
        `${s.attention.length} need a person.`,
    );
  } finally {
    await pool.end();
  }
});
