import { z } from 'zod';
import {
  ELECTION_TYPES,
  LEGISLATIVE_CHAMBERS,
  OFFICE_BRANCHES,
  OFFICE_LEVELS,
  PRIMARY_SYSTEMS,
  RACE_STATUSES,
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
