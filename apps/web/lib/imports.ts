import type { CandidacyStatus } from '@civicscope/core';
import { CANDIDACY_STATUS_LABELS } from './labels';

/** Shows an imported or locked field's value the way an editor would read it. */
export function formatImportValue(
  field: string,
  value: unknown,
  partyNames: Map<number, string>,
): string {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (field === 'partyId') return partyNames.get(Number(value)) ?? `party ${String(value)}`;
  if (field === 'isIncumbent') return value ? 'Yes' : 'No';
  if (field === 'status') return CANDIDACY_STATUS_LABELS[value as CandidacyStatus] ?? String(value);
  return String(value);
}
