import { z } from 'zod';
import {
  BIO_CATEGORIES,
  CANDIDACY_STATUSES,
  CLAIM_KINDS,
  PROMISE_RECORD_TYPES,
  CONTENT_KINDS,
  POSITION_TYPES,
  CITATION_SUBJECTS,
  CORRECTION_STATES,
  COVERAGE_LEVELS,
  ELECTION_DEADLINE_KINDS,
  ELECTION_TYPES,
  OFFICIAL_RESOURCE_KINDS,
  LEGISLATIVE_CHAMBERS,
  OFFICE_BRANCHES,
  OFFICE_LEVELS,
  PERSON_IDENTIFIER_SCHEMES,
  PRIMARY_SYSTEMS,
  RACE_STATUSES,
  SOURCE_TYPES,
} from './enums';
import { isValidPrimarySystem, racePartyError } from './race-rules';

/**
 * Input schemas shared by admin forms, CSV import and ingestion. They accept the
 * strings an HTML form submits: blank optional fields become null, numbers and
 * checkboxes are coerced.
 */

const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());

const requiredText = (label: string, min: number, max: number) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(min, `${label[0]!.toUpperCase()}${label.slice(1)} must be at least ${min} characters.`)
    .max(max, `Keep ${label} under ${max} characters.`);

const id = (label: string) =>
  z.coerce
    .number({ error: `Choose ${label}.` })
    .int()
    .positive(`Choose ${label}.`);

const optionalId = z.preprocess(
  blankToNull,
  z.coerce.number().int().positive().nullable().optional(),
);

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const httpsUrl = z.preprocess(
  blankToNull,
  z
    .url({ protocol: /^https$/, error: 'Enter a full https:// address.' })
    .max(2048)
    .nullable()
    .optional(),
);

const isoDate = z.iso.date({ error: 'Enter a valid date.' });

export const partyInputSchema = z.object({
  name: requiredText('a name', 2, 200),
  shortName: optionalText(50),
  fecCode: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
    z
      .string()
      .regex(/^[A-Z]{1,3}$/, 'FEC party codes are one to three letters, like DEM, UN or W.')
      .nullable()
      .optional(),
  ),
  jurisdictionId: optionalId,
});
export type PartyInput = z.infer<typeof partyInputSchema>;

export const officeInputSchema = z
  .object({
    jurisdictionId: id('a jurisdiction'),
    title: requiredText('a title', 3, 200),
    level: z.enum(OFFICE_LEVELS),
    branch: z.enum(OFFICE_BRANCHES),
    chamber: z.preprocess(blankToNull, z.enum(LEGISLATIVE_CHAMBERS).nullable().optional()),
    seats: z.coerce.number().int().min(1).max(500).default(1),
    termYears: z.preprocess(
      blankToNull,
      z.coerce.number().int().min(1).max(20).nullable().optional(),
    ),
    isPartisan: checkbox,
  })
  .superRefine((value, ctx) => {
    if (value.chamber && value.branch !== 'legislative') {
      ctx.addIssue({
        code: 'custom',
        path: ['chamber'],
        message: 'Only legislative offices have a chamber.',
      });
    }
  });
export type OfficeInput = z.infer<typeof officeInputSchema>;

export const electionInputSchema = z
  .object({
    jurisdictionId: id('a state'),
    type: z.enum(ELECTION_TYPES),
    primarySystem: z.enum(PRIMARY_SYSTEMS),
    date: isoDate,
    name: requiredText('a name', 3, 200),
    officialUrl: httpsUrl,
  })
  .superRefine((value, ctx) => {
    if (!isValidPrimarySystem(value.type, value.primarySystem)) {
      ctx.addIssue({
        code: 'custom',
        path: ['primarySystem'],
        message:
          value.primarySystem === 'not_applicable'
            ? 'A primary or convention must say which primary system it uses.'
            : 'A general election has no primary system; choose "Not applicable".',
      });
    }
  });
export type ElectionInput = z.infer<typeof electionInputSchema>;

export const raceInputSchema = z
  .object({
    electionId: id('an election'),
    officeId: id('an office'),
    districtId: optionalId,
    partyId: optionalId,
    name: requiredText('a name', 3, 200),
    seats: z.coerce.number().int().min(1).max(100).default(1),
    isSpecial: checkbox,
    status: z.enum(RACE_STATUSES).default('scheduled'),
    /** When the winner takes office. Only with the official source that states it. */
    termStartsOn: z.preprocess(blankToNull, isoDate.nullable().optional()),
    termStartSourceUrl: httpsUrl,
  })
  .superRefine((r, ctx) => {
    if (r.termStartsOn && !r.termStartSourceUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['termStartSourceUrl'],
        message: 'Link the official source that sets this date.',
      });
    }
    if (!r.termStartsOn && r.termStartSourceUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['termStartsOn'],
        message: 'Enter the date, or clear the source.',
      });
    }
  });
export type RaceInput = z.infer<typeof raceInputSchema>;

/**
 * A date that matters for an election (filing, registration, early voting...). Every
 * one must name the official document that sets it: dates are never guessed from a
 * previous cycle.
 */
export const electionDeadlineInputSchema = z.object({
  electionId: id('an election'),
  kind: z.enum(ELECTION_DEADLINE_KINDS, { error: 'Choose what kind of date this is.' }),
  date: isoDate,
  label: requiredText('a description', 3, 200),
  sourceUrl: z.preprocess(
    blankToNull,
    z
      .url({ protocol: /^https$/, error: 'Enter the https:// address of the official source.' })
      .max(2048),
  ),
});
export type ElectionDeadlineInput = z.infer<typeof electionDeadlineInputSchema>;

/** A link to an official election authority or resource for a state. */
export const officialResourceInputSchema = z.object({
  jurisdictionId: id('a state'),
  kind: z.enum(OFFICIAL_RESOURCE_KINDS, { error: 'Choose what kind of resource this is.' }),
  label: requiredText('a label', 3, 200),
  url: z.preprocess(
    blankToNull,
    z.url({ protocol: /^https$/, error: 'Enter a full https:// address.' }).max(2048),
  ),
});
export type OfficialResourceInput = z.infer<typeof officialResourceInputSchema>;

/** Checks the rules that depend on the race's election, not just its own fields. */
export function validateRaceForElection(
  race: Pick<RaceInput, 'partyId'>,
  election: Pick<ElectionInput, 'type' | 'primarySystem'>,
): string[] {
  const errors: string[] = [];
  const partyError = racePartyError(election.type, election.primarySystem, race.partyId);
  if (partyError) errors.push(partyError);
  return errors;
}

const optionalDate = z.preprocess(blankToNull, isoDate.nullable().optional());

/** Today's date as YYYY-MM-DD in UTC; the admin forms only ever need day precision. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

const notInFuture = (label: string) =>
  isoDate.refine((d) => d <= todayIso(), `${label} can't be in the future.`);

const webUrl = z.url({
  protocol: /^https?$/,
  error: 'Enter the full web address, starting with https:// (or http://).',
});

export const personInputSchema = z.object({
  fullName: requiredText('a full name', 2, 200),
  preferredName: optionalText(100),
  /** Blank means "work it out from the full name". */
  sortName: optionalText(200),
  birthYear: z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: 'Enter a four-digit year.' })
      .int()
      .min(1900, 'Enter a four-digit year.')
      .max(new Date().getUTCFullYear() - 18, 'Candidates must be adults.')
      .nullable()
      .optional(),
  ),
});
export type PersonInput = z.infer<typeof personInputSchema>;

/** Format checks for the ID systems that have a fixed shape. */
const IDENTIFIER_FORMATS: Partial<Record<string, [RegExp, string]>> = {
  fec_candidate_id: [/^[HSP][0-9A-Z]{8}$/, 'FEC candidate IDs look like H8VA07094 or P80001571.'],
  bioguide: [/^[A-Z][0-9]{6}$/, 'Bioguide IDs look like K000394.'],
  wikidata: [/^Q[0-9]+$/, 'Wikidata IDs look like Q22686.'],
};

export const personIdentifierInputSchema = z
  .object({
    scheme: z.enum(PERSON_IDENTIFIER_SCHEMES, { error: 'Choose an ID type.' }),
    value: z
      .string({ error: 'Enter the ID.' })
      .trim()
      .min(1, 'Enter the ID.')
      .max(100, 'Keep the ID under 100 characters.'),
  })
  .transform((v) => (IDENTIFIER_FORMATS[v.scheme] ? { ...v, value: v.value.toUpperCase() } : v))
  .superRefine((v, ctx) => {
    const format = IDENTIFIER_FORMATS[v.scheme];
    if (format && !format[0].test(v.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: format[1] });
    }
  });
export type PersonIdentifierInput = z.infer<typeof personIdentifierInputSchema>;

export const candidacyInputSchema = z.object({
  personId: id('a person'),
  raceId: id('a race'),
  partyId: optionalId,
  /** Blank means "use the person's full name". */
  ballotName: optionalText(200),
  isIncumbent: checkbox,
  campaignUrl: httpsUrl,
  fecCommitteeId: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
    z
      .string()
      .regex(/^C[0-9]{8}$/, 'FEC committee IDs look like C00123456.')
      .nullable()
      .optional(),
  ),
});
export type CandidacyInput = z.infer<typeof candidacyInputSchema>;

/**
 * The source behind a citation. Give the URL of the document; if CivicScope already
 * knows that URL the existing source is reused, otherwise title, publisher and type
 * are needed to create it.
 */
export const sourceRefSchema = z.object({
  sourceUrl: z.preprocess(blankToNull, webUrl.max(2048)),
  sourceTitle: optionalText(500),
  sourcePublisher: optionalText(200),
  sourceType: z.preprocess(blankToNull, z.enum(SOURCE_TYPES).nullable().optional()),
  sourcePublishedAt: optionalDate,
});
export type SourceRefInput = z.infer<typeof sourceRefSchema>;

export const citationInputSchema = sourceRefSchema.extend({
  subjectType: z.enum(CITATION_SUBJECTS),
  subjectId: id('a record'),
  /** Which field the source supports, e.g. "fullName"; blank means the record as a whole. */
  field: optionalText(64),
  excerpt: optionalText(2000),
  locator: optionalText(200),
});
export type CitationInput = z.infer<typeof citationInputSchema>;

export const sourceInputSchema = z.object({
  url: webUrl.max(2048),
  title: requiredText('a title', 2, 500),
  publisher: requiredText('a publisher', 2, 200),
  sourceType: z.enum(SOURCE_TYPES, { error: 'Choose a source type.' }),
  publishedAt: optionalDate,
  retrievedAt: notInFuture('The date you checked it'),
  archiveUrl: httpsUrl,
});
export type SourceInput = z.infer<typeof sourceInputSchema>;

export const statusEventInputSchema = sourceRefSchema.extend({
  status: z.enum(CANDIDACY_STATUSES, { error: 'Choose a status.' }),
  effectiveDate: notInFuture('The status date'),
  note: optionalText(500),
  excerpt: optionalText(2000),
});
export type StatusEventInput = z.infer<typeof statusEventInputSchema>;

export const issueInputSchema = z.object({
  name: requiredText('a name', 2, 100),
  description: optionalText(500),
});
export type IssueInput = z.infer<typeof issueInputSchema>;

const optionalYear = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: 'Enter a four-digit year.' })
    .int()
    .min(1900, 'Enter a four-digit year.')
    .max(2200, 'Enter a four-digit year.')
    .nullable()
    .optional(),
);

/**
 * One profile entry. Which fields apply depends on the kind; the rest must be blank,
 * so a position never carries a stray biography category and so on.
 */
export const claimInputSchema = z
  .object({
    personId: id('a person'),
    kind: z.enum(CLAIM_KINDS, { error: 'Choose what kind of entry this is.' }),
    contentKind: z.enum(CONTENT_KINDS, { error: 'Choose where this information comes from.' }),
    title: requiredText('a short title', 3, 200),
    summary: requiredText('a summary', 10, 2000),
    quote: optionalText(2000),
    issueId: optionalId,
    positionType: z.preprocess(blankToNull, z.enum(POSITION_TYPES).nullable().optional()),
    bioCategory: z.preprocess(blankToNull, z.enum(BIO_CATEGORIES).nullable().optional()),
    organization: optionalText(200),
    statedOn: optionalDate,
    venue: optionalText(200),
    startYear: optionalYear,
    endYear: optionalYear,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.kind === 'position') {
      if (!v.issueId) issue('issueId', 'Choose the issue this position is about.');
      if (!v.positionType) issue('positionType', 'Choose what kind of statement this is.');
    }
    if (v.kind === 'biography' && !v.bioCategory) {
      issue('bioCategory', 'Choose a category.');
    }
    if (v.kind !== 'position') {
      if (v.issueId) issue('issueId', 'Only positions have an issue.');
      if (v.positionType) issue('positionType', 'Only positions have a statement type.');
    }
    if (v.kind !== 'biography' && v.bioCategory) {
      issue('bioCategory', 'Only biography entries have a category.');
    }
    if (v.startYear && v.endYear && v.endYear < v.startYear) {
      issue('endYear', 'The end year is before the start year.');
    }
    if (v.statedOn && v.statedOn > todayIso()) {
      issue('statedOn', "This date can't be in the future.");
    }
    // Positions always carry the candidate's own words, so readers can judge the summary.
    if (v.kind === 'position' && !v.quote) {
      issue('quote', 'Quote their exact words from the source.');
    }
  });
export type ClaimInput = z.infer<typeof claimInputSchema>;

/**
 * An official record set next to a campaign promise. `record` is "type:id" from the
 * picker, e.g. "vote:812". The note describes the record, not whether a promise was kept.
 */
export const promiseLinkInputSchema = z.object({
  record: z
    .string({ error: 'Choose a bill or vote.' })
    .regex(
      new RegExp(`^(${PROMISE_RECORD_TYPES.join('|')}):[1-9][0-9]{0,9}$`),
      'Choose a bill or vote.',
    )
    .transform((v) => {
      const [type, rid] = v.split(':');
      return { type: type as (typeof PROMISE_RECORD_TYPES)[number], id: Number(rid) };
    }),
  note: requiredText('a note on how this record relates', 10, 500),
});
export type PromiseLinkInput = z.infer<typeof promiseLinkInputSchema>;

export const reviewNoteSchema = z.object({
  note: optionalText(1000),
});

/** URL-safe identifier from a display name: "Governor of Kentucky" -> "governor-of-kentucky". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

/** Field-level messages for showing next to form inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

const yesNo = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase();
    if (s === '') return null;
    if (['yes', 'y', 'true', '1', 'x'].includes(s)) return true;
    if (['no', 'n', 'false', '0'].includes(s)) return false;
    return v;
  },
  z.boolean({ error: 'Use yes or no.' }).nullable().optional(),
);

/**
 * One row of a candidate CSV import. Blank cells mean "the file says nothing about
 * this", so an import never clears a value. Party is resolved against the parties
 * table later; person_id is a number to link an existing person, or "new".
 */
export const candidateImportRowSchema = z
  .object({
    fullName: requiredText('a full name', 2, 200),
    /** Only used when the row creates a person; otherwise guessed from the full name. */
    sortName: optionalText(200),
    ballotName: optionalText(200),
    party: optionalText(200),
    incumbent: yesNo,
    status: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v),
      z
        .enum(CANDIDACY_STATUSES, { error: `Use one of: ${CANDIDACY_STATUSES.join(', ')}.` })
        .nullable()
        .optional(),
    ),
    statusDate: z.preprocess(blankToNull, notInFuture('The status date').nullable().optional()),
    campaignUrl: httpsUrl,
    fecCandidateId: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^[HSP][0-9A-Z]{8}$/, 'FEC candidate IDs look like H8VA07094.')
        .nullable()
        .optional(),
    ),
    fecCommitteeId: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^C[0-9]{8}$/, 'FEC committee IDs look like C00123456.')
        .nullable()
        .optional(),
    ),
    personId: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v),
      z
        .union([z.literal('new'), z.coerce.number().int().positive()], {
          error: 'Use a person number from CivicScope, or "new".',
        })
        .nullable()
        .optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.status && !v.statusDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['statusDate'],
        message: 'Give the date of this status.',
      });
    }
    if (v.statusDate && !v.status) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Give the status for this date.' });
    }
  });
export type CandidateImportRow = z.infer<typeof candidateImportRowSchema>;

/** CSV header (normalized with csvHeaderKey) → row field. */
export const CANDIDATE_IMPORT_COLUMNS = {
  full_name: 'fullName',
  sort_name: 'sortName',
  ballot_name: 'ballotName',
  party: 'party',
  incumbent: 'incumbent',
  status: 'status',
  status_date: 'statusDate',
  campaign_url: 'campaignUrl',
  fec_candidate_id: 'fecCandidateId',
  fec_committee_id: 'fecCommitteeId',
  person_id: 'personId',
} as const satisfies Record<string, keyof CandidateImportRow>;

/** What an import is about: the race its rows go into and the document they came from. */
export const candidateImportInputSchema = sourceRefSchema.extend({
  raceId: id('a race'),
});
export type CandidateImportInput = z.infer<typeof candidateImportInputSchema>;

/** Where a candidate photo came from and whose it is; shown under the photo. */
export const photoCreditSchema = z.object({
  sourceUrl: z.preprocess(blankToNull, webUrl.max(2048).nullable().optional()),
  credit: requiredText('a photo credit', 2, 200),
});
export type PhotoCreditInput = z.infer<typeof photoCreditSchema>;

export const photoLinkSchema = photoCreditSchema.extend({
  imageUrl: z
    .url({ protocol: /^https$/, error: 'Enter the image’s full https:// address.' })
    .max(2048),
});
export type PhotoLinkInput = z.infer<typeof photoLinkSchema>;

/** A path on this site, like /candidates/jane-doe. Never a full URL to somewhere else. */
const sitePath = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(500)
    .regex(/^\/(?!\/)[^\s\\]*$/, 'Use the address of a CivicScope page, starting with /.')
    .nullable()
    .optional(),
);

/** What a reader sends with the public correction form. */
export const correctionRequestSchema = z.object({
  pagePath: sitePath,
  description: requiredText('what is wrong', 10, 4000),
  evidenceUrl: z.preprocess(blankToNull, webUrl.max(2048).nullable().optional()),
  contactEmail: z.preprocess(
    blankToNull,
    z
      .email({ error: 'Enter a valid email address, or leave it blank.' })
      .max(254)
      .nullable()
      .optional(),
  ),
});
export type CorrectionRequestInput = z.infer<typeof correctionRequestSchema>;

/** An editor's decision on a correction request. */
export const correctionResolutionSchema = z
  .object({
    state: z.enum(CORRECTION_STATES),
    internalNote: optionalText(2000),
    publicNote: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    if (value.publicNote && value.state !== 'fixed') {
      ctx.addIssue({
        code: 'custom',
        path: ['publicNote'],
        message: 'Only a fixed request can go in the public corrections log.',
      });
    }
  });
export type CorrectionResolutionInput = z.infer<typeof correctionResolutionSchema>;

/** One row of the public Coverage page. */
export const coverageInputSchema = z
  .object({
    jurisdictionId: id('a state'),
    cycleYear: z.coerce
      .number({ error: 'Enter a year.' })
      .int('Enter a year.')
      .min(2024, 'Enter a year from 2024 on.')
      .max(2100, 'Enter a year before 2100.'),
    officeLevel: z.enum(OFFICE_LEVELS),
    level: z.enum(COVERAGE_LEVELS),
    asOf: optionalDate,
    note: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.level === 'complete' && !value.asOf) {
      ctx.addIssue({
        code: 'custom',
        path: ['asOf'],
        message: 'Say the date the coverage was complete as of.',
      });
    }
  });
export type CoverageInput = z.infer<typeof coverageInputSchema>;
