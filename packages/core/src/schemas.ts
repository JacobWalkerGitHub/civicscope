import { z } from 'zod';
import { ELECTION_TYPES, PRIMARY_SYSTEMS, PUBLISH_STATES, RACE_STATUSES } from './enums';
import { isValidPrimarySystem, racePartyError } from './race-rules';

const isoDate = z.iso.date();

export const electionInputSchema = z
  .object({
    cycleId: z.number().int().positive(),
    jurisdictionId: z.number().int().positive(),
    type: z.enum(ELECTION_TYPES),
    primarySystem: z.enum(PRIMARY_SYSTEMS),
    date: isoDate,
    name: z.string().trim().min(3).max(200),
    officialUrl: z
      .url({ protocol: /^https$/ })
      .nullable()
      .optional(),
    publishState: z.enum(PUBLISH_STATES).default('draft'),
  })
  .superRefine((value, ctx) => {
    if (!isValidPrimarySystem(value.type, value.primarySystem)) {
      ctx.addIssue({
        code: 'custom',
        path: ['primarySystem'],
        message:
          value.primarySystem === 'not_applicable'
            ? 'A primary or convention must say which primary system it uses.'
            : 'A general election has no primary system; use "not_applicable".',
      });
    }
  });
export type ElectionInput = z.infer<typeof electionInputSchema>;

/** Race input, validated against the election it belongs to. */
export const raceInputSchema = z.object({
  electionId: z.number().int().positive(),
  officeId: z.number().int().positive(),
  districtId: z.number().int().positive().nullable().optional(),
  partyId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(3).max(200),
  seats: z.number().int().min(1).max(100).default(1),
  isSpecial: z.boolean().default(false),
  status: z.enum(RACE_STATUSES).default('scheduled'),
  publishState: z.enum(PUBLISH_STATES).default('draft'),
});
export type RaceInput = z.infer<typeof raceInputSchema>;

export function validateRaceForElection(
  race: RaceInput,
  election: Pick<ElectionInput, 'type' | 'primarySystem'>,
): string[] {
  const errors: string[] = [];
  const partyError = racePartyError(election.type, election.primarySystem, race.partyId);
  if (partyError) errors.push(partyError);
  return errors;
}
