import {
  GENERAL_ELECTION_TYPES,
  PARTISAN_PRIMARY_SYSTEMS,
  PRIMARY_ELECTION_TYPES,
  type ElectionType,
  type PrimarySystem,
} from './enums';

const primaryTypes: readonly string[] = PRIMARY_ELECTION_TYPES;
const generalTypes: readonly string[] = GENERAL_ELECTION_TYPES;
const partisanSystems: readonly string[] = PARTISAN_PRIMARY_SYSTEMS;

export function isPrimaryElectionType(type: ElectionType): boolean {
  return primaryTypes.includes(type);
}

export function isGeneralElectionType(type: ElectionType): boolean {
  return generalTypes.includes(type);
}

/**
 * Which primary systems are valid for an election type.
 * General elections have no primary system; primaries must name one.
 * The database enforces the same rule with a CHECK constraint on `election`.
 */
export function isValidPrimarySystem(type: ElectionType, system: PrimarySystem): boolean {
  return isGeneralElectionType(type) ? system === 'not_applicable' : system !== 'not_applicable';
}

export type RacePartyRule = 'required' | 'forbidden';

/**
 * Whether a race must name a party.
 * Only a partisan primary (or party convention) is a single party's contest. Every
 * other race, including jungle and top-two primaries, is open to candidates of any
 * party, so the race itself has no party. The database enforces the same rule with a
 * CHECK constraint on `race`.
 */
export function racePartyRule(type: ElectionType, system: PrimarySystem): RacePartyRule {
  return isPrimaryElectionType(type) && partisanSystems.includes(system) ? 'required' : 'forbidden';
}

export function racePartyError(
  type: ElectionType,
  system: PrimarySystem,
  partyId: number | null | undefined,
): string | null {
  const rule = racePartyRule(type, system);
  const hasParty = partyId !== null && partyId !== undefined;
  if (rule === 'required' && !hasParty) {
    return `A ${system.replace('_', ' ')} ${type.replace('_', ' ')} race must name the party holding it.`;
  }
  if (rule === 'forbidden' && hasParty) {
    return `A ${type.replace('_', ' ')} race under the "${system}" system is open to all parties and cannot name one.`;
  }
  return null;
}
