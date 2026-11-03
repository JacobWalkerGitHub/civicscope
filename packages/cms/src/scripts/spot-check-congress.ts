import { parseArgs } from 'node:util';
import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { spotCheckVotes } from '../congress-spot-check';

/**
 * Checks a random sample of imported votes against the chamber's own record (the
 * Clerk's for the House, senate.gov's for the Senate) and congress-legislators.
 * Read-only.
 *   pnpm check:congress-votes [--chamber house|senate] [--sample 60] [--candidates-only]
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const { values } = parseArgs({
    options: {
      sample: { type: 'string' },
      'candidates-only': { type: 'boolean' },
      chamber: { type: 'string' },
    },
  });
  const chamber = values.chamber ?? 'house';
  if (chamber !== 'house' && chamber !== 'senate') {
    throw new Error('--chamber must be house or senate.');
  }
  const pool = createPool(url);
  try {
    const res = await spotCheckVotes(createDb(pool), {
      chamber,
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
          `recorded: ${r.clerkName} (${r.clerkState})`.padEnd(36),
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
