import { z } from 'zod';
import {
  CANDIDACY_STATUSES,
  CITATION_SUBJECTS,
  ELECTION_TYPES,
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
      .regex(/^[A-Z]{3}$/, 'FEC party codes are three letters, like DEM or LIB.')
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

export const raceInputSchema = z.object({
  electionId: id('an election'),
  officeId: id('an office'),
  districtId: optionalId,
  partyId: optionalId,
  name: requiredText('a name', 3, 200),
  seats: z.coerce.number().int().min(1).max(100).default(1),
  isSpecial: checkbox,
  status: z.enum(RACE_STATUSES).default('scheduled'),
});
export type RaceInput = z.infer<typeof raceInputSchema>;

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
