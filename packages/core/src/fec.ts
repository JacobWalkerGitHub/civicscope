import { z } from 'zod';

/**
 * The parts of an OpenFEC /v1/candidates/ record that CivicScope uses. Other fields
 * are kept in the raw snapshot but ignored here. A record that doesn't match fails
 * the whole run, so a change in the FEC's format is noticed instead of half-imported.
 */
export const fecCandidateSchema = z.looseObject({
  candidate_id: z.string().regex(/^[HSP][0-9A-Z]{8}$/),
  /** Null (with most other fields) on a registration the FEC hasn't processed yet. */
  name: z
    .string()
    .trim()
    .nullable()
    .transform((n) => n || null),
  office: z.enum(['H', 'S', 'P']),
  state: z.string().regex(/^[A-Z]{2}$/),
  /** Two digits; "00" for Senate, President and at-large House seats. */
  district: z
    .string()
    .regex(/^\d{2}$/)
    .nullable(),
  /** The FEC's party code, e.g. DEM, REP, LIB, UN (unaffiliated). */
  party: z.string().nullable(),
  /** I: incumbent, C: challenger, O: open seat. */
  incumbent_challenge: z.enum(['I', 'C', 'O']).nullable(),
  /** C: statutory candidate (crossed the $5,000 threshold); F, N, P: other states. */
  candidate_status: z.string().nullable(),
  candidate_inactive: z.boolean().nullable().optional(),
  first_file_date: z.iso.date().nullable().optional(),
  election_years: z.array(z.number().int()).nullable().optional(),
});
export type FecCandidate = z.infer<typeof fecCandidateSchema>;

export const fecCandidatePageSchema = z.looseObject({
  results: z.array(fecCandidateSchema),
  pagination: z.looseObject({
    page: z.number().int().positive(),
    pages: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  }),
});
export type FecCandidatePage = z.infer<typeof fecCandidatePageSchema>;

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'HON', 'REV', 'SEN', 'REP', 'GOV']);
const bare = (token: string) => token.replace(/[.,]/g, '').toUpperCase();

function titleCaseWord(word: string): string {
  if (/^(II|III|IV|V)$/i.test(word)) return word.toUpperCase();
  return word
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/^Mc(\p{L})/u, (_, ch: string) => `Mc${ch.toUpperCase()}`);
}

function splitFecName(raw: string) {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const comma = clean.indexOf(',');
  const last = comma === -1 ? '' : clean.slice(0, comma).trim();
  const rest = (comma === -1 ? clean : clean.slice(comma + 1)).split(/[\s,]+/).filter(Boolean);
  const given: string[] = [];
  const suffixes: string[] = [];
  for (const token of rest) {
    const key = bare(token);
    if (TITLES.has(key)) continue;
    if (SUFFIXES.has(key))
      suffixes.push(key === 'JR' || key === 'SR' ? `${titleCaseWord(key)}.` : key);
    else given.push(token);
  }
  return {
    given: given.map(titleCaseWord),
    last: last ? last.split(' ').map(titleCaseWord) : [],
    suffixes,
  };
}

/**
 * The FEC lists names as "LAST, FIRST MIDDLE SUFFIX" in capitals. This turns them into
 * "First Middle Last Suffix". Capitalization is a best guess (the FEC doesn't keep the
 * original), so editors should check names before publishing.
 */
export function formatFecName(raw: string): string {
  const { given, last, suffixes } = splitFecName(raw);
  return [...given, ...last, ...suffixes].join(' ');
}

/**
 * The sort name ("Last Suffix, First Middle") for an FEC name. The FEC already says
 * where the surname ends, so "VAN HOLLEN, CHRIS" sorts under V, not H, which guessing
 * from the display name can't tell.
 */
export function fecSortName(raw: string): string {
  const { given, last, suffixes } = splitFecName(raw);
  if (!last.length || !given.length) return formatFecName(raw);
  return `${[...last, ...suffixes].join(' ')}, ${given.join(' ')}`;
}

/**
 * The state an FEC Senate or House candidate ID was issued for: characters 3 and 4,
 * as in S6MD03441 (Maryland). Presidential IDs carry no state.
 */
export function fecIdState(candidateId: string): string | null {
  return /^[HS]\d[A-Z]{2}/.test(candidateId) ? candidateId.slice(2, 4) : null;
}

/** U.S. general elections: the Tuesday after the first Monday in November. */
export function generalElectionDate(year: number): string {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - nov1) % 7);
  const day = firstMonday + 1;
  return `${year}-11-${String(day).padStart(2, '0')}`;
}

/** The public FEC page that lists the candidates for one race; cited as the source. */
export function fecCandidateListUrl(opts: {
  office: 'H' | 'S' | 'P';
  cycle: number;
  state?: string;
  district?: string | null;
}): string {
  const path = { H: 'house', S: 'senate', P: 'president' }[opts.office];
  const url = new URL(`https://www.fec.gov/data/candidates/${path}/`);
  url.searchParams.set('election_year', String(opts.cycle));
  if (opts.office !== 'P' && opts.state) url.searchParams.set('state', opts.state);
  if (opts.office === 'H' && opts.district && opts.district !== '00') {
    url.searchParams.set('district', opts.district);
  }
  return url.toString();
}
