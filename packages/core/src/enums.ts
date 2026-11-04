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
  'sign_in',
  'sign_out',
  'role_change',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Kinds of source documents. Each maps to a reliability tier (see sourceTier): primary
 * official records first, then independent reporting, then a candidate's own words.
 */
export const SOURCE_TYPES = [
  'official_election_authority',
  'government_record',
  'legislative_record',
  'court_record',
  'news',
  'campaign_site',
  'reference',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** External ID systems used to recognize the same person across data sources. */
export const PERSON_IDENTIFIER_SCHEMES = [
  'fec_candidate_id',
  'bioguide',
  'openstates',
  'state_filing',
  'ballotpedia',
  'wikidata',
] as const;
export type PersonIdentifierScheme = (typeof PERSON_IDENTIFIER_SCHEMES)[number];

/** Where a candidacy stands. Each change is a dated, sourced event. */
export const CANDIDACY_STATUSES = [
  'announced',
  // Registered with a campaign-finance regulator (for federal races, the FEC). This is
  // about money, not the ballot: it never means the person is on a ballot.
  'registered',
  'filed',
  'qualified',
  'withdrawn',
  'disqualified',
  'advanced',
  'won',
  'lost',
] as const;
export type CandidacyStatus = (typeof CANDIDACY_STATUSES)[number];

/** Record types a citation can point at. */
export const CITATION_SUBJECTS = ['person', 'candidacy', 'claim'] as const;
export type CitationSubject = (typeof CITATION_SUBJECTS)[number];

/**
 * Entries on a candidate's profile. Each is one sourced statement about the person:
 * - position: what they have said about an issue
 * - biography: education, work, service and civic roles
 * - accomplishment: something documented that they did
 */
export const CLAIM_KINDS = ['position', 'biography', 'accomplishment'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const POSITION_TYPES = ['stated_position', 'campaign_promise', 'public_statement'] as const;
export type PositionType = (typeof POSITION_TYPES)[number];

export const BIO_CATEGORIES = [
  'education',
  'employment',
  'military',
  'public_service',
  'civic',
  'other',
] as const;
export type BioCategory = (typeof BIO_CATEGORIES)[number];

/**
 * Where the content of an entry comes from, shown to readers so a candidate's own
 * claims are never presented as established fact.
 */
export const CONTENT_KINDS = [
  'sourced_fact',
  'candidate_claim',
  'independent_analysis',
  'editorial_summary',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** Review state of an entry, separate from whether it is published. */
export const VERIFICATION_STATUSES = [
  'unverified',
  'pending_review',
  'verified',
  'disputed',
  'outdated',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Fields that imports and ingestion may write. When someone changes one of these by
 * hand, it is locked: later imports record what their source says but cannot
 * overwrite it, and a difference opens a conflict for review instead.
 */
export const LOCKABLE_FIELDS = {
  candidacy: ['ballotName', 'partyId', 'isIncumbent', 'campaignUrl', 'fecCommitteeId', 'status'],
} as const;
export type LockableEntity = keyof typeof LOCKABLE_FIELDS;
export type LockableField<E extends LockableEntity = LockableEntity> =
  (typeof LOCKABLE_FIELDS)[E][number];

/** candidates: a CSV someone uploaded; fec: written by the automated FEC import. */
export const IMPORT_KINDS = ['candidates', 'fec'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** preview: uploaded and checkable; applied: written in one transaction; discarded: abandoned. */
export const IMPORT_STATES = ['preview', 'applied', 'discarded'] as const;
export type ImportState = (typeof IMPORT_STATES)[number];

export const CONFLICT_STATES = ['open', 'accepted', 'rejected'] as const;
export type ConflictState = (typeof CONFLICT_STATES)[number];

/**
 * Where a reader's correction request stands.
 * new: not looked at yet; in_review: someone is checking it; fixed: the record was
 * changed; no_change: checked and found accurate; spam: not a real request.
 */
export const CORRECTION_STATES = ['new', 'in_review', 'fixed', 'no_change', 'spam'] as const;
export type CorrectionState = (typeof CORRECTION_STATES)[number];

/** How much of one state's races for one office level CivicScope covers in a cycle. */
export const COVERAGE_LEVELS = ['none', 'partial', 'complete'] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

/**
 * Automated data sources, each with its own connector.
 * - fec: OpenFEC candidate registrations
 * - congress_legislators: the unitedstates/congress-legislators ID crosswalk
 * - congress_gov: members, bills and House votes from the Congress.gov API
 */
export const INGEST_SOURCES = [
  'fec',
  'congress_legislators',
  'congress_gov',
  'state_results',
  'openstates',
  'fec_totals',
] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

export const INGEST_RUN_STATES = ['running', 'succeeded', 'failed'] as const;
export type IngestRunState = (typeof INGEST_RUN_STATES)[number];

export const CONGRESS_CHAMBERS = ['house', 'senate'] as const;
export type CongressChamber = (typeof CONGRESS_CHAMBERS)[number];

/** A member's part in a bill: its sponsor, or a cosponsor who signed on. */
export const SPONSORSHIP_ROLES = ['sponsor', 'cosponsor'] as const;
export type SponsorshipRole = (typeof SPONSORSHIP_ROLES)[number];

/** How a live-results contest is grouped on the page, most prominent first. */
export const RESULT_GROUPS = [
  'federal',
  'statewide',
  'legislature',
  'judicial',
  'measure',
  'local',
] as const;
export type ResultGroup = (typeof RESULT_GROUPS)[number];
