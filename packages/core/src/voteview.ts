import { z } from 'zod';
import { parseCsv } from './csv';

/*
 * Senate roll-call votes from Voteview (https://voteview.com), the UCLA political
 * science project that has kept every congressional roll call since 1789. Its files are
 * built from the Senate's own roll-call records and updated as the Senate votes. We use
 * it because senate.gov refuses requests from servers (its firewall answers 403), and
 * Congress.gov has no Senate vote endpoint.
 *
 * Three CSV files per Congress:
 * - rollcalls: one row per vote, with the Senate's own roll call number
 *   ("clerk_rollnumber"), session, date, question, result and measure;
 * - votes: one row per senator per vote, with Voteview's cast code;
 * - members: everyone who voted, with their Bioguide ID.
 *
 * Voteview also scores the President's stated position on some votes (a "President"
 * row in members). That is not a Senate vote and is never stored. Every file is checked
 * against the columns CivicScope uses; a file that doesn't match fails the run.
 */

export const VOTEVIEW_BASE = 'https://voteview.com';

export function voteviewFileUrl(kind: 'rollcalls' | 'votes' | 'members', congress: number) {
  return `${VOTEVIEW_BASE}/static/data/out/${kind}/S${congress}_${kind}.csv`;
}

/** Voteview's page for one vote. `rollnumber` is Voteview's own running number. */
export function voteviewRollcallUrl(congress: number, rollnumber: number): string {
  return `${VOTEVIEW_BASE}/rollcall/RS${congress}${String(rollnumber).padStart(4, '0')}`;
}

/** Reads a CSV file into objects keyed by its header; throws if a needed column is missing. */
export function readVoteviewCsv(body: string, columns: readonly string[]) {
  const rows = parseCsv(body);
  const header = rows.shift()?.cells.map((c) => c.trim());
  if (!header) throw new Error('the file is empty');
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`missing column ${missing.join(', ')}`);
  return rows.map((r) => ({
    line: r.line,
    row: Object.fromEntries(header.map((h, i) => [h, r.cells[i]?.trim() ?? ''])),
  }));
}

const whole = z.string().regex(/^\d+$/).transform(Number);
const text = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, ' ').trim() || null : null));

export const voteviewRollcallSchema = z.looseObject({
  congress: whole,
  chamber: z.literal('Senate'),
  rollnumber: whole,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: whole,
  clerk_rollnumber: whole,
  majority_requirement: text,
  yea_count: whole,
  nay_count: whole,
  bill_number: text,
  vote_result: text,
  vote_desc: text,
  vote_question: text,
});
export type VoteviewRollcall = z.infer<typeof voteviewRollcallSchema>;

export const voteviewMemberSchema = z.looseObject({
  congress: whole,
  chamber: z.string(),
  icpsr: whole,
  state_abbrev: z.string(),
  party_code: z.string(),
  bioname: text,
  bioguide_id: text,
});
export type VoteviewMember = z.infer<typeof voteviewMemberSchema>;

export const voteviewVoteSchema = z.looseObject({
  congress: whole,
  chamber: z.literal('Senate'),
  rollnumber: whole,
  icpsr: whole,
  cast_code: z.string().regex(/^\d$/).transform(Number),
});
export type VoteviewVote = z.infer<typeof voteviewVoteSchema>;

export const VOTEVIEW_COLUMNS = {
  rollcalls: Object.keys(voteviewRollcallSchema.shape),
  members: Object.keys(voteviewMemberSchema.shape),
  votes: Object.keys(voteviewVoteSchema.shape),
} as const;

/**
 * Voteview's cast code as the Senate records it. 1 Yea; 6 Nay; 2-5 are paired or
 * announced positions, which the Senate's tally counts as not voting; 7-8 Present;
 * 9 Not Voting; 0 not a senator at the time (nothing stored).
 */
export function voteviewCast(code: number): string | null {
  if (code === 1) return 'Yea';
  if (code === 6) return 'Nay';
  if (code >= 2 && code <= 5) return 'Not Voting';
  if (code === 7 || code === 8) return 'Present';
  if (code === 9) return 'Not Voting';
  return null;
}

/** Yea-side codes, nay-side codes: what Voteview's yea_count and nay_count add up. */
export const isVoteviewYea = (code: number) => code >= 1 && code <= 3;
export const isVoteviewNay = (code: number) => code >= 4 && code <= 6;

/** Voteview's party code as the Senate abbreviates it. */
export function voteviewParty(code: string): string | null {
  if (code === '100') return 'D';
  if (code === '200') return 'R';
  if (code === '328') return 'I';
  return code ? code.slice(0, 10) : null;
}

/** "S5" -> { type: "S", number: "5" }; "PN1129" -> { type: "PN", number: "1129" }. */
export function voteviewMeasure(
  billNumber: string | null,
): { type: string; number: string } | null {
  const m = billNumber ? /^([A-Za-z.]+)\s*(\d[\w-]*)$/.exec(billNumber) : null;
  return m ? { type: m[1]!.toUpperCase(), number: m[2]! } : null;
}

/**
 * A date ("2025-01-09") as a time on that day where the Senate sits. Voteview gives no
 * time of day, and CivicScope shows only the date, so midday Eastern stands in for it.
 */
export function voteviewDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 17, 0));
}
