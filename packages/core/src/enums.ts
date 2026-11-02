/**
 * Closed sets of values shared by the database schema, validation and UI.
 * The database enums are generated from these arrays, so they cannot drift apart.
 */

export const JURISDICTION_TYPES = [
  'country',
  'state',
  'federal_district',
  'territory',
  'county',
  'municipality',
  'township',
  'school_district',
  'special_district',
  'other',
] as const;
export type JurisdictionType = (typeof JURISDICTION_TYPES)[number];

export const DISTRICT_TYPES = [
  'congressional',
  'state_upper',
  'state_lower',
  'at_large',
  'other',
] as const;
export type DistrictType = (typeof DISTRICT_TYPES)[number];

export const OFFICE_LEVELS = ['federal', 'state', 'local'] as const;
export type OfficeLevel = (typeof OFFICE_LEVELS)[number];

export const OFFICE_BRANCHES = ['executive', 'legislative', 'judicial', 'other'] as const;
export type OfficeBranch = (typeof OFFICE_BRANCHES)[number];

export const LEGISLATIVE_CHAMBERS = ['upper', 'lower', 'unicameral'] as const;
export type LegislativeChamber = (typeof LEGISLATIVE_CHAMBERS)[number];

/**
 * Election types. A "primary" type is any contest that narrows the field before a
 * general election (including party conventions, which Virginia parties may use).
 */
export const PRIMARY_ELECTION_TYPES = [
  'primary',
  'primary_runoff',
  'special_primary',
  'convention',
] as const;
export const GENERAL_ELECTION_TYPES = [
  'general',
  'general_runoff',
  'special_general',
  'special_runoff',
] as const;
export const ELECTION_TYPES = [...PRIMARY_ELECTION_TYPES, ...GENERAL_ELECTION_TYPES] as const;
export type ElectionType = (typeof ELECTION_TYPES)[number];

/**
 * How a primary works.
 * - Partisan systems (closed, semi_closed, open_partisan): each party has its own contest.
 * - Nonpartisan systems (top_two, jungle, nonpartisan): all candidates share one contest,
 *   regardless of party. Louisiana's governor race uses this ("jungle") system.
 * - not_applicable: used for general elections.
 */
export const PARTISAN_PRIMARY_SYSTEMS = ['closed', 'semi_closed', 'open_partisan'] as const;
export const NONPARTISAN_PRIMARY_SYSTEMS = ['top_two', 'jungle', 'nonpartisan'] as const;
export const PRIMARY_SYSTEMS = [
  ...PARTISAN_PRIMARY_SYSTEMS,
  ...NONPARTISAN_PRIMARY_SYSTEMS,
  'not_applicable',
] as const;
export type PrimarySystem = (typeof PRIMARY_SYSTEMS)[number];

export const RACE_STATUSES = ['scheduled', 'uncontested', 'cancelled', 'certified'] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

export const PUBLISH_STATES = ['draft', 'published', 'unpublished', 'archived'] as const;
export type PublishState = (typeof PUBLISH_STATES)[number];

export const ELECTION_DEADLINE_KINDS = [
  'filing_open',
  'filing_close',
  'petition',
  'withdrawal',
  'voter_registration',
  'mail_ballot_request',
  'early_voting_start',
  'early_voting_end',
  'certification',
  'other',
] as const;
export type ElectionDeadlineKind = (typeof ELECTION_DEADLINE_KINDS)[number];

export const OFFICIAL_RESOURCE_KINDS = [
  'election_authority',
  'candidate_list',
  'results',
  'voter_registration',
  'polling_place',
  'campaign_finance',
  'other',
] as const;
export type OfficialResourceKind = (typeof OFFICIAL_RESOURCE_KINDS)[number];

export const AUDIT_ACTOR_TYPES = ['user', 'job', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'publish',
  'unpublish',
  'archive',
  'restore',
  'merge',
  'split',
  'import',
  'delete',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
