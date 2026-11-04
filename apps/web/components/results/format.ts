// No imports from @civicscope/cms here: the county map (a client component) uses this
// file, and the CMS package reaches the database.
const reportingShare = (c: { precinctsTotal: number | null; precinctsReporting: number | null }) =>
  c.precinctsTotal ? Math.min(1, (c.precinctsReporting ?? 0) / c.precinctsTotal) : null;

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

/** The party side a label belongs to, for map colors only. */
export function partySide(party: string | null | undefined): 'rep' | 'dem' | 'oth' {
  const p = (party ?? '').toUpperCase();
  if (p === 'REP' || p === 'R' || p.startsWith('REPUBLICAN')) return 'rep';
  if (p === 'DEM' || p === 'D' || p.startsWith('DEMOCRAT')) return 'dem';
  return 'oth';
}

/**
 * The map class for an area: who leads (by party side) and by how much, or that no votes
 * are in yet. Deeper shades for bigger leads: under 5, 5 to 15, over 15 points.
 */
export function leaderClass(
  votes: Record<string, number>,
  candidates: { key: string; party: string | null }[],
): string {
  const ranked = candidates.map((c) => ({ ...c, v: votes[c.key] ?? 0 })).sort((a, b) => b.v - a.v);
  const total = ranked.reduce((n, c) => n + c.v, 0);
  if (!ranked[0] || total === 0) return 'lead-none';
  if (ranked[1] && ranked[1].v === ranked[0].v) return 'lead-tie';
  const margin = ((ranked[0].v - (ranked[1]?.v ?? 0)) / total) * 100;
  const depth = margin < 5 ? 1 : margin < 15 ? 2 : 3;
  return `lead-${partySide(ranked[0].party)}-${depth}`;
}

export const LEAD_LEGEND = [
  { cls: 'lead-rep-3', label: 'Republican leads' },
  { cls: 'lead-dem-3', label: 'Democrat leads' },
  { cls: 'lead-oth-3', label: 'Other leads' },
  { cls: 'lead-tie', label: 'Tied' },
  { cls: 'lead-none', label: 'No votes yet' },
] as const;
