import { reportingShare } from '@civicscope/cms';

export const fmt = (n: number) => n.toLocaleString('en-US');

export const pct = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%';

/** A map/legend bucket for a share of precincts counted. Neutral shades, not party colors. */
export function reportingBucket(share: number | null): 'none' | 'r0' | 'r1' | 'r2' | 'r3' {
  if (share === null) return 'none';
  if (share <= 0) return 'r0';
  if (share < 0.5) return 'r1';
  if (share < 1) return 'r2';
  return 'r3';
}

export function reportingText(c: {
  precinctsTotal: number | null;
  precinctsReporting: number | null;
}): string {
  const share = reportingShare(c);
  if (share === null) return 'Precinct count not reported';
  return `${fmt(c.precinctsReporting ?? 0)} of ${fmt(c.precinctsTotal ?? 0)} precincts (${Math.round(share * 100)}%)`;
}

export const timeEt = (d: Date | null) =>
  d
    ? `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`
    : 'not yet';

export const LEGEND = [
  { bucket: 'r0', label: 'Awaiting results' },
  { bucket: 'r1', label: 'Under half counted' },
  { bucket: 'r2', label: 'Half or more counted' },
  { bucket: 'r3', label: 'All precincts in' },
  { bucket: 'none', label: 'No official feed yet' },
] as const;
