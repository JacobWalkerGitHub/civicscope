import { parseArgs } from 'node:util';
import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { spotCheckHouseVotes } from '../congress-spot-check';

/**
 * Checks a random sample of imported House votes against the Clerk's record and
 * congress-legislators. Read-only.
 *   pnpm check:congress-votes [--sample 60] [--candidates-only]
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const { values } = parseArgs({
    options: { sample: { type: 'string' }, 'candidates-only': { type: 'boolean' } },
  });
  const pool = createPool(url);
  try {
    const res = await spotCheckHouseVotes(createDb(pool), {
      sample: values.sample ? Number(values.sample) : 60,
      onlyCandidates: values['candidates-only'] ?? false,
    });
    for (const r of res.rows) {
      console.log(
        [
          r.problems.length ? 'FAIL' : 'ok  ',
          r.roll.padEnd(10),
          r.bioguideId,
          `#${r.personId} ${r.personName}`.padEnd(34),
          `clerk: ${r.clerkName} (${r.clerkState})`.padEnd(36),
          r.voteCast.padEnd(10),
          r.isCandidate ? 'already a candidate' : 'new from crosswalk',
          r.problems.join(' '),
        ].join('  '),
      );
    }
    console.log(`${res.passed} of ${res.checked} sampled votes attach to the right member.`);
    if (res.passed !== res.checked) process.exitCode = 1;
  } finally {
    await pool.end();
  }
});
