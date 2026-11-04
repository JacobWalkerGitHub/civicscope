import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { alertOnFailure } from '../alerts';
import { OPENSTATES_MAX_REQUESTS, OPENSTATES_STATES, runOpenStatesImport } from '../openstates';

/**
 * Imports state legislators and their bill votes from Open States, continuing where the
 * last run stopped.
 *   pnpm ingest:openstates [--states VA,NJ] [--max-requests 300]
 * Needs OPENSTATES_API_KEY (a free key from https://docs.openstates.org/api-v3/).
 */
await runCli(() =>
  alertOnFailure('Open States import failed', async () => {
    const url = requireDatabaseUrl();
    const arg = (name: string) => {
      const i = process.argv.indexOf(name);
      return i > -1 ? process.argv[i + 1] : undefined;
    };
    const states = (arg('--states') ?? OPENSTATES_STATES.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (states.some((s) => !/^[A-Z]{2}$/.test(s))) {
      throw new Error('Give --states as two-letter codes, e.g. --states VA,NJ.');
    }
    const maxRequests = Number(arg('--max-requests') ?? OPENSTATES_MAX_REQUESTS);
    if (!(maxRequests > 0)) throw new Error('--max-requests must be a positive number.');
    const apiKey = process.env.OPENSTATES_API_KEY ?? '';
    if (!apiKey) {
      throw new Error(
        'OPENSTATES_API_KEY is not set. Get a free key at https://docs.openstates.org/api-v3/ and add it to .env.',
      );
    }
    const pool = createPool(url);
    try {
      const { runId, summary: s } = await runOpenStatesImport(createDb(pool), {
        apiKey,
        states,
        maxRequests,
      });
      console.log(
        `Open States (run ${runId}, ${s.requests} requests): ${s.created} new people, ` +
          `${s.linked} linked, ${s.unchanged} unchanged, ${s.attention.length} need a person.`,
      );
      for (const x of s.states) {
        console.log(
          `  ${x.state}: ${x.legislators} legislators, ${x.billsWithVotes} bills with ${x.votes} votes` +
            (x.caughtUp ? ', caught up' : ', continues next run'),
        );
      }
    } finally {
      await pool.end();
    }
  }),
);
