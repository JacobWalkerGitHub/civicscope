import type {
  BioCategory,
  ClaimKind,
  ContentKind,
  PositionType,
  VerificationStatus,
  CandidacyStatus,
  PersonIdentifierScheme,
  SourceType,
  ElectionDeadlineKind,
  ElectionType,
  OfficialResourceKind,
  OfficeBranch,
  OfficeLevel,
  LegislativeChamber,
  PrimarySystem,
  PublishState,
  RaceStatus,
  BillStage,
  CongressChamber,
} from '@civicscope/core';
import { stateNameFor } from '@civicscope/core';

export const ELECTION_TYPE_LABELS: Record<ElectionType, string> = {
  primary: 'Primary',
  primary_runoff: 'Primary runoff',
  special_primary: 'Special primary',
  convention: 'Party convention',
  general: 'General',
  general_runoff: 'General runoff',
  special_general: 'Special general',
  special_runoff: 'Special runoff',
};

export const PRIMARY_SYSTEM_LABELS: Record<PrimarySystem, string> = {
  closed: 'Closed (party members only)',
  semi_closed: 'Semi-closed (members + unaffiliated)',
  open_partisan: 'Open (any voter picks one party ballot)',
  top_two: 'Top-two (all candidates on one ballot)',
  jungle: 'Jungle / open blanket (all candidates on one ballot)',
  nonpartisan: 'Nonpartisan',
  not_applicable: 'Not applicable (general election)',
};

/**
 * How each primary system works, in plain words, for the public race and election
 * pages. Describes the rules only; says nothing about which party benefits.
 */
export const PRIMARY_SYSTEM_EXPLANATIONS: Record<PrimarySystem, string> = {
  closed:
    'Each party holds its own primary, and only voters registered with that party can vote in it. Each party’s winner goes on to the general election.',
  semi_closed:
    'Each party holds its own primary. Voters registered with a party vote in that party’s primary; voters not registered with any party can usually choose one party’s primary. Each party’s winner goes on to the general election.',
  open_partisan:
    'Each party holds its own primary, and any registered voter can choose one party’s ballot. Each party’s winner goes on to the general election.',
  top_two:
    'All candidates, whatever their party, run on one primary ballot, and every voter gets the same ballot. The two candidates with the most votes advance to the general election, even if they belong to the same party.',
  jungle:
    'All candidates, whatever their party, run on one ballot, and every voter gets the same ballot. A candidate who wins a majority of the votes wins the office outright. If no one does, the top two advance to a second election, even if they belong to the same party.',
  nonpartisan:
    'Candidates run without party labels on the ballot. The rules for who advances are set by the state and are explained on the election office page.',
  not_applicable: '',
};

export const DEADLINE_KIND_LABELS: Record<ElectionDeadlineKind, string> = {
  filing_open: 'Candidate filing opens',
  filing_close: 'Candidate filing deadline',
  petition: 'Petition deadline',
  withdrawal: 'Withdrawal deadline',
  voter_registration: 'Voter registration deadline',
  mail_ballot_request: 'Mail ballot request deadline',
  early_voting_start: 'Early voting begins',
  early_voting_end: 'Early voting ends',
  certification: 'Results certified',
  other: 'Other',
};

export const RESOURCE_KIND_LABELS: Record<OfficialResourceKind, string> = {
  election_authority: 'Election office',
  candidate_list: 'Official candidate list',
  results: 'Official results',
  voter_registration: 'Register or check registration',
  polling_place: 'Find your polling place',
  campaign_finance: 'Campaign finance reports',
  other: 'Other',
};

export const PUBLISH_STATE_LABELS: Record<PublishState, string> = {
  draft: 'Draft',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
};

export const RACE_STATUS_LABELS: Record<RaceStatus, string> = {
  scheduled: 'Scheduled',
  uncontested: 'Uncontested',
  cancelled: 'Cancelled',
  certified: 'Results certified',
};

export const OFFICE_LEVEL_LABELS: Record<OfficeLevel, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
};

export const OFFICE_BRANCH_LABELS: Record<OfficeBranch, string> = {
  executive: 'Executive',
  legislative: 'Legislative',
  judicial: 'Judicial',
  other: 'Other',
};

export const CHAMBER_LABELS: Record<LegislativeChamber, string> = {
  upper: 'Upper (Senate)',
  lower: 'Lower (House / Assembly / Delegates)',
  unicameral: 'Unicameral',
};

export const options = <K extends string>(labels: Record<K, string>) =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

export const dateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Formats a YYYY-MM-DD date without shifting it across time zones. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  official_election_authority: 'Official election authority',
  government_record: 'Government record',
  legislative_record: 'Legislative record',
  court_record: 'Court record',
  news: 'News reporting',
  campaign_site: 'Candidate or campaign material',
  reference: 'Reference work',
  other: 'Other',
};

export const TIER_LABELS = {
  1: 'Tier 1 · official record',
  2: 'Tier 2 · independent reporting',
  3: 'Tier 3 · candidate or reference',
  4: 'Tier 4 · other',
} as const;

export const IDENTIFIER_SCHEME_LABELS: Record<PersonIdentifierScheme, string> = {
  fec_candidate_id: 'FEC candidate ID',
  bioguide: 'Congressional Bioguide ID',
  openstates: 'Open States person ID',
  state_filing: 'State filing ID',
  ballotpedia: 'Ballotpedia page name',
  wikidata: 'Wikidata ID',
};

export const CANDIDACY_STATUS_LABELS: Record<CandidacyStatus, string> = {
  announced: 'Announced',
  registered: 'Registered with the FEC (not a ballot listing)',
  filed: 'Filed',
  qualified: 'Qualified for the ballot',
  withdrawn: 'Withdrew',
  disqualified: 'Disqualified',
  advanced: 'Advanced to the next round',
  won: 'Won',
  lost: 'Lost',
};

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  position: 'Position',
  biography: 'Biography',
  accomplishment: 'Accomplishment',
};

export const CLAIM_KIND_PLURALS: Record<ClaimKind, string> = {
  position: 'Positions',
  biography: 'Biography',
  accomplishment: 'Accomplishments',
};

export const POSITION_TYPE_LABELS: Record<PositionType, string> = {
  stated_position: 'Stated position',
  campaign_promise: 'Campaign promise',
  public_statement: 'Public statement',
};

export const BIO_CATEGORY_LABELS: Record<BioCategory, string> = {
  education: 'Education',
  employment: 'Work',
  military: 'Military service',
  public_service: 'Public office or government service',
  civic: 'Civic and community roles',
  other: 'Other',
};

/** Shown next to each entry so readers know whose account it is. */
export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  sourced_fact: 'Fact from a record (official or independent)',
  candidate_claim: 'The candidate’s own account',
  independent_analysis: 'Independent analysis',
  editorial_summary: 'CivicScope summary',
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unverified: 'Not yet reviewed',
  pending_review: 'Waiting for review',
  verified: 'Verified',
  disputed: 'Disputed',
  outdated: 'Outdated',
};

export const BILL_STAGE_LABELS: Record<BillStage, string> = {
  introduced: 'Introduced',
  committee: 'In committee',
  reported: 'Out of committee',
  passed_house: 'Passed the House',
  passed_senate: 'Passed the Senate',
  passed_both: 'Passed both chambers',
  law: 'Became law',
  adopted: 'Adopted',
  vetoed: 'Vetoed',
  failed: 'Failed a vote',
};

/** How each stage is drawn: outcomes stand out, everything else is neutral. */
export const BILL_STAGE_TONES: Record<BillStage, string> = {
  introduced: 'none',
  committee: 'none',
  reported: 'running',
  passed_house: 'advanced',
  passed_senate: 'advanced',
  passed_both: 'advanced',
  law: 'won',
  adopted: 'won',
  vetoed: 'out',
  failed: 'lost',
};

export const CONGRESS_CHAMBER_LABELS: Record<CongressChamber, string> = {
  house: 'House',
  senate: 'Senate',
};

export const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** "Sen. · Kentucky" style seat description for a Member of Congress. */
export function seatLabel(chamber: CongressChamber, state: string, district: number | null) {
  const name = stateNameFor(state);
  if (chamber === 'senate') return `U.S. Senator, ${name}`;
  if (district === 0 || district == null) return `U.S. Representative, ${name} at large`;
  return `U.S. Representative, ${name} District ${district}`;
}

// ---------------------------------------------------------------------------------
// State legislatures

/** Lower chambers not called the House of Representatives. */
const LOWER_CHAMBERS: Record<string, string> = {
  CA: 'Assembly',
  NV: 'Assembly',
  NY: 'Assembly',
  WI: 'Assembly',
  NJ: 'General Assembly',
  MD: 'House of Delegates',
  VA: 'House of Delegates',
  WV: 'House of Delegates',
};

/** "Senate", "House of Delegates", "Legislature" (Nebraska's single chamber). */
export function stateChamberName(state: string, chamber: 'upper' | 'lower' | 'legislature') {
  if (chamber === 'legislature') return 'Legislature';
  if (chamber === 'upper') return 'Senate';
  return LOWER_CHAMBERS[state] ?? 'House of Representatives';
}

/** "Governor of Virginia", "Virginia House of Delegates, District 2". */
export function stateSeatLabel(
  role: 'governor' | 'upper' | 'lower' | 'legislature',
  state: string,
  district: string | null,
) {
  const name = stateNameFor(state);
  if (role === 'governor') return `Governor of ${name}`;
  const chamber = `${name} ${stateChamberName(state, role)}`;
  if (!district) return chamber;
  return /^\d+[A-Z]?$/i.test(district)
    ? `${chamber}, District ${district}`
    : `${chamber}, ${district}`;
}
