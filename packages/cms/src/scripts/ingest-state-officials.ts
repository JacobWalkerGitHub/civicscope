import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertOnFailure } from '../alerts';
import { runStateOfficialsImport, STATE_OFFICIAL_STATES } from '../state-officials';

/**
 * Imports the governors and state legislators in office from Open States' public files.
 *   pnpm ingest:state-officials [--states VA,NJ]
 * Needs no API key. GITHUB_TOKEN, if set, raises GitHub's rate limit for the governor list.
 */
await runCli(() =>
  alertOnFailure('Governor and state legislator import failed', async () => {
    const url = requireDatabaseUrl();
    const i = process.argv.indexOf('--states');
    const states = (i > -1 ? (process.argv[i + 1] ?? '') : STATE_OFFICIAL_STATES.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const unknown = states.filter((s) => !STATE_OFFICIAL_STATES.includes(s));
    if (states.length === 0 || unknown.length) {
      throw new Error(
        `Give --states as two-letter codes of the 50 states, e.g. --states VA,NJ${unknown.length ? ` (not known: ${unknown.join(', ')})` : ''}.`,
      );
    }
    const pool = createPool(url);
    try {
      const { runId, summary: s } = await runStateOfficialsImport(createDb(pool), {
        states,
        githubToken: process.env.GITHUB_TOKEN || undefined,
      });
      const total = (k: 'added' | 'updated' | 'left' | 'legislators') =>
        s.states.reduce((n, x) => n + x[k], 0);
      console.log(
        `State officials (run ${runId}, ${s.requests} requests): ` +
          `${s.states.filter((x) => x.governor).length} governors, ${total('legislators')} legislators; ` +
          `${total('added')} added, ${total('updated')} changed, ${total('left')} left office.`,
      );
      for (const a of s.attention) console.log(`  Needs a person, ${a.state}: ${a.problem}`);
    } finally {
      await pool.end();
    }
  }),
);
