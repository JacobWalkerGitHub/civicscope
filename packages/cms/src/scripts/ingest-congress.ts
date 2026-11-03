import { parseArgs } from 'node:util';
import { createDb, createPool } from '@civicscope/db';
import { requireDatabaseUrl, runCli } from '@civicscope/db/env';
import { CONGRESS_PARTS, runCongressImport, type CongressPart } from '../congress-import';

/**
 * Imports one Congress from the Congress.gov API: members, bills (with sponsors and
 * cosponsors) and House roll-call votes; and Senate roll-call votes from senate.gov.
 * Run `pnpm ingest:legislators` first.
 *   pnpm ingest:congress 119 [--parts members,bills,house-votes,senate-votes]
 *                            [--max-bills 500] [--max-votes 100] [--max-requests 4000]
 *                            [--refresh-senate]
 * Needs CONGRESS_API_KEY (a free api.data.gov key) for every part except senate-votes.
 * DEMO_KEY allows about 10 requests an hour, so use it only with a small --max-requests.
 * --refresh-senate fetches stored Senate votes again to pick up corrections.
 */
await runCli(async () => {
  const url = requireDatabaseUrl();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      parts: { type: 'string' },
      'max-bills': { type: 'string' },
      'max-votes': { type: 'string' },
      'max-requests': { type: 'string' },
      'refresh-senate': { type: 'boolean' },
    },
  });
  const congress = Number(positionals[0]);
  if (!Number.isInteger(congress) || congress < 93 || congress > 200) {
    throw new Error('Give a Congress number, e.g. `pnpm ingest:congress 119`.');
  }
  const parts = (values.parts?.split(',') ?? [...CONGRESS_PARTS]) as CongressPart[];
  const bad = parts.filter((p) => !(CONGRESS_PARTS as readonly string[]).includes(p));
  if (bad.length)
    throw new Error(`Unknown part: ${bad.join(', ')}. Use ${CONGRESS_PARTS.join(', ')}.`);
  const num = (v: string | undefined, name: string) => {
    if (v == null) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number.`);
    return n;
  };
  const apiKey = process.env.CONGRESS_API_KEY ?? '';
  if (!apiKey && parts.some((p) => p !== 'senate-votes')) {
    throw new Error(
      'CONGRESS_API_KEY is not set. Get a free key at https://api.data.gov/signup/ and add it to .env.',
    );
  }
  const pool = createPool(url);
  try {
    const { runId, summary: s } = await runCongressImport(createDb(pool), congress, {
      apiKey,
      parts,
      maxBills: num(values['max-bills'], 'max-bills'),
      maxVotes: num(values['max-votes'], 'max-votes'),
      maxRequests: num(values['max-requests'], 'max-requests'),
      refreshSenateVotes: values['refresh-senate'] ?? false,
    });
    const t = (x: { created: number; updated: number; unchanged: number; deferred: number }) =>
      `${x.created} new, ${x.updated} updated, ${x.unchanged} unchanged${x.deferred ? `, ${x.deferred} left for next run` : ''}`;
    console.log(
      `Congress.gov ${congress}th Congress import (run ${runId}), ${s.requests} requests:`,
    );
    if (parts.includes('members')) console.log(`  Members: ${t(s.members)}`);
    if (parts.includes('bills'))
      console.log(`  Bills: ${t(s.bills)}; ${s.bills.sponsorships} sponsor rows changed`);
    if (parts.includes('house-votes'))
      console.log(`  House votes: ${t(s.votes)}; ${s.votes.positions} member votes stored`);
    if (parts.includes('senate-votes') && s.senateVotes)
      console.log(
        `  Senate votes: ${t(s.senateVotes)}; ${s.senateVotes.positions} senator votes stored`,
      );
    console.log(
      `  ${s.unmatched.length} members with no CivicScope person yet, ${s.attention.length} need a person.`,
    );
    if (s.stoppedEarly) console.log(`  ${s.stoppedEarly}`);
  } finally {
    await pool.end();
  }
});
