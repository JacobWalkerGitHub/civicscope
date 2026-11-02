import type {
  ElectionType,
  OfficeBranch,
  OfficeLevel,
  LegislativeChamber,
  PrimarySystem,
  PublishState,
  RaceStatus,
} from '@civicscope/core';

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
