import { z } from 'zod';

/*
 * Shapes of the two Congress data sources CivicScope reads, and small helpers.
 *
 * - unitedstates/congress-legislators (https://unitedstates.github.io/congress-legislators/):
 *   one record per Member of Congress with their IDs in other systems (Bioguide, FEC,
 *   Wikidata, ...). Used as the ID crosswalk.
 * - The Congress.gov API (https://api.congress.gov/v3): members, bills, sponsors and
 *   cosponsors, and House roll-call votes.
 *
 * Only the fields CivicScope uses are checked; the rest stay in the raw snapshot. A
 * record that doesn't match fails the run, so a format change is noticed.
 */

export const BIOGUIDE_ID = /^[A-Z]\d{6}$/;
const bioguideId = z.string().regex(BIOGUIDE_ID);
const usps = z.string().regex(/^[A-Z]{2}$/);

// ---------------------------------------------------------------------------------
// congress-legislators

export const legislatorTermSchema = z.looseObject({
  type: z.enum(['rep', 'sen']),
  start: z.iso.date(),
  end: z.iso.date(),
  state: usps,
  /** House only; 0 for at-large seats (and -1 in some old records). */
  district: z.number().int().optional(),
  party: z.string().optional(),
});

export const legislatorSchema = z.looseObject({
  id: z.looseObject({
    bioguide: bioguideId,
    fec: z.array(z.string().regex(/^[HSP][0-9A-Z]{8}$/)).optional(),
    wikidata: z
      .string()
      .regex(/^Q\d+$/)
      .optional(),
    /** The Senate's own member ID ("S428"), used in its roll-call vote files. */
    lis: z
      .string()
      .regex(/^S\d{3}$/)
      .optional(),
  }),
  name: z.looseObject({
    first: z.string().min(1),
    last: z.string().min(1),
    middle: z.string().optional(),
    suffix: z.string().optional(),
    nickname: z.string().optional(),
    official_full: z.string().optional(),
  }),
  terms: z.array(legislatorTermSchema).min(1),
});
export type Legislator = z.infer<typeof legislatorSchema>;
export const legislatorFileSchema = z.array(legislatorSchema);

export const LEGISLATORS_BASE = 'https://unitedstates.github.io/congress-legislators/';
/** The project page, cited for the ID crosswalk. */
export const LEGISLATORS_PROJECT_URL = 'https://github.com/unitedstates/congress-legislators';

/** The name a legislator is known by in Congress, e.g. "Maria Cantwell". */
export function legislatorFullName(l: Legislator): string {
  if (l.name.official_full) return l.name.official_full.trim();
  const first = l.name.nickname ?? l.name.first;
  return [first, l.name.last, l.name.suffix].filter(Boolean).join(' ');
}

/** "Last Suffix, First", sorted under the surname the source gives. */
export function legislatorSortName(l: Legislator): string {
  const first = l.name.nickname ?? l.name.first;
  return `${[l.name.last, l.name.suffix].filter(Boolean).join(' ')}, ${first}`;
}

// ---------------------------------------------------------------------------------
// Congress.gov API

export const CONGRESS_API_BASE = 'https://api.congress.gov';

const pagination = z.looseObject({
  count: z.number().int().nonnegative(),
  next: z.string().nullable().optional(),
});

/** Congress.gov reports House and Senate service with these chamber names. */
const chamberName = z.enum(['House of Representatives', 'Senate']);

export const congressMemberSchema = z.looseObject({
  bioguideId,
  name: z.string().min(1),
  /** Full state or territory name, e.g. "Massachusetts". */
  state: z.string().min(1),
  district: z.number().int().nullable().optional(),
  partyName: z.string().nullable().optional(),
  terms: z.looseObject({
    item: z.array(
      z.looseObject({
        chamber: chamberName,
        startYear: z.number().int(),
        endYear: z.number().int().nullable().optional(),
      }),
    ),
  }),
  updateDate: z.string().nullable().optional(),
});
export type CongressMember = z.infer<typeof congressMemberSchema>;
export const congressMemberPageSchema = z.looseObject({
  members: z.array(congressMemberSchema),
  pagination,
});

/** Bills and resolutions, in Congress.gov's lowercase codes. */
export const BILL_TYPES = [
  'hr',
  's',
  'hjres',
  'sjres',
  'hconres',
  'sconres',
  'hres',
  'sres',
] as const;
export type BillType = (typeof BILL_TYPES)[number];
const billType = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(BILL_TYPES));

const latestAction = z
  .looseObject({ actionDate: z.iso.date().nullable().optional(), text: z.string().nullable() })
  .nullable()
  .optional();

export const congressBillListItemSchema = z.looseObject({
  congress: z.number().int(),
  type: billType,
  number: z.string().regex(/^\d+$/),
  title: z.string().nullable().optional(),
  latestAction,
  updateDate: z.string().min(1),
});
export const congressBillPageSchema = z.looseObject({
  bills: z.array(congressBillListItemSchema),
  pagination,
});

const sponsorSchema = z.looseObject({
  bioguideId,
  fullName: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
});

export const congressBillDetailSchema = z.looseObject({
  bill: z.looseObject({
    congress: z.number().int(),
    type: billType,
    number: z.string().regex(/^\d+$/),
    title: z.string().min(1),
    introducedDate: z.iso.date().nullable().optional(),
    policyArea: z.looseObject({ name: z.string() }).nullable().optional(),
    latestAction,
    sponsors: z.array(sponsorSchema).optional(),
    cosponsors: z.looseObject({ count: z.number().int().nonnegative() }).nullable().optional(),
    updateDate: z.string().min(1),
  }),
});
export type CongressBillDetail = z.infer<typeof congressBillDetailSchema>['bill'];

export const congressCosponsorPageSchema = z.looseObject({
  cosponsors: z.array(
    sponsorSchema.extend({
      isOriginalCosponsor: z.boolean().nullable().optional(),
      sponsorshipDate: z.iso.date().nullable().optional(),
      sponsorshipWithdrawnDate: z.iso.date().nullable().optional(),
    }),
  ),
  pagination,
});

export const houseVoteListItemSchema = z.looseObject({
  congress: z.number().int(),
  sessionNumber: z.number().int().min(1).max(3),
  rollCallNumber: z.number().int().positive(),
  updateDate: z.string().min(1),
});
export const houseVotePageSchema = z.looseObject({
  houseRollCallVotes: z.array(houseVoteListItemSchema),
  pagination,
});

/**
 * How a member's vote is usually recorded. Not a closed set: in an election for
 * Speaker, members vote for a person, so the "vote" is a surname.
 */
export const COMMON_VOTE_CASTS = ['Yea', 'Nay', 'Aye', 'No', 'Present', 'Not Voting'] as const;

export const houseVoteMembersSchema = z.looseObject({
  houseRollCallVoteMemberVotes: z.looseObject({
    congress: z.number().int(),
    sessionNumber: z.number().int().min(1).max(3),
    rollCallNumber: z.number().int().positive(),
    startDate: z.iso.datetime({ offset: true }),
    updateDate: z.string().min(1),
    voteQuestion: z.string().nullable().optional(),
    voteType: z.string().nullable().optional(),
    result: z.string().nullable().optional(),
    legislationType: z.string().nullable().optional(),
    legislationNumber: z.string().nullable().optional(),
    sourceDataURL: z.url().nullable().optional(),
    results: z.array(
      z.looseObject({
        // Congress.gov spells this one "bioguideID".
        bioguideID: bioguideId,
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        voteCast: z.string().trim().min(1).max(100),
        voteParty: z.string().nullable().optional(),
        voteState: z.string().nullable().optional(),
      }),
    ),
  }),
});
export type HouseVoteMembers = z.infer<
  typeof houseVoteMembersSchema
>['houseRollCallVoteMemberVotes'];

// ---------------------------------------------------------------------------------
// Helpers

/** The two calendar years a Congress sits in: the 119th is 2025-2026. */
export function congressYears(congress: number): [number, number] {
  const first = 1789 + 2 * (congress - 1);
  return [first, first + 1];
}

const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

const BILL_PATHS: Record<BillType, string> = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution',
};
const BILL_LABELS: Record<BillType, string> = {
  hr: 'H.R.',
  s: 'S.',
  hjres: 'H.J.Res.',
  sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.',
  sconres: 'S.Con.Res.',
  hres: 'H.Res.',
  sres: 'S.Res.',
};

export const isBillType = (t: string): t is BillType => t in BILL_PATHS;

/** The public Congress.gov page for a bill, cited as its source. */
export function congressGovBillUrl(congress: number, type: BillType, number: number): string {
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${BILL_PATHS[type]}/${number}`;
}

/** "H.R. 3424" */
export function billLabel(type: BillType, number: number): string {
  return `${BILL_LABELS[type]} ${number}`;
}

/** A member's entry in the Biographical Directory of the U.S. Congress. */
export function bioguideUrl(id: string): string {
  return `https://bioguide.congress.gov/search/bio/${id}`;
}

/** USPS codes for the state and territory names Congress.gov uses. */
const STATE_CODES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'District of Columbia': 'DC',
  'American Samoa': 'AS',
  Guam: 'GU',
  'Northern Mariana Islands': 'MP',
  'Puerto Rico': 'PR',
  'Virgin Islands': 'VI',
};

/** "Massachusetts" -> "MA"; null for a name it doesn't know. */
export function stateCode(name: string): string | null {
  return STATE_CODES[name.trim()] ?? null;
}
