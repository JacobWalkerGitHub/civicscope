import type { CandidacyStatus } from '@civicscope/core';
import { formatDate } from '@/lib/labels';

/*
 * Status at a glance. Colors carry outcome only (won, out of the race), never party:
 * candidates are never colored by party on CivicScope.
 */

type Tone = 'won' | 'advanced' | 'ballot' | 'running' | 'registered' | 'lost' | 'out' | 'none';

const STATUS: Record<CandidacyStatus, { label: string; tone: Tone }> = {
  won: { label: 'Won', tone: 'won' },
  advanced: { label: 'Advanced', tone: 'advanced' },
  qualified: { label: 'On the ballot', tone: 'ballot' },
  filed: { label: 'Filed', tone: 'running' },
  announced: { label: 'Announced', tone: 'running' },
  registered: { label: 'FEC registered', tone: 'registered' },
  lost: { label: 'Lost', tone: 'lost' },
  withdrawn: { label: 'Withdrew', tone: 'out' },
  disqualified: { label: 'Disqualified', tone: 'out' },
};

export const statusTone = (s: CandidacyStatus | null): Tone => (s ? STATUS[s].tone : 'none');

/** A candidacy's status as a small colored pill, with its date in the hover text. */
export function StatusBadge({
  status,
  date,
}: {
  status: CandidacyStatus | null;
  date?: string | null;
}) {
  const s = status ? STATUS[status] : { label: 'No status yet', tone: 'none' as const };
  return (
    <span
      className={`status-badge tone-${s.tone}`}
      title={date ? `${s.label} as of ${formatDate(date)}` : undefined}
    >
      {s.tone === 'won' && <span aria-hidden="true">✓ </span>}
      {s.label}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

/** "In 12 days", "Today" or "Held Nov 3, 2026", from today's date in Eastern time. */
export function WhenChip({ date }: { date: string }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  const text =
    days === 0
      ? 'Election day is today'
      : days > 0
        ? `In ${days} ${days === 1 ? 'day' : 'days'}`
        : `Held ${formatDate(date)}`;
  return <span className={`chip when ${days >= 0 ? 'upcoming' : 'past'}`}>{text}</span>;
}
