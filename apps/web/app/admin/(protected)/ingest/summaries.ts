import type { CongressRunSummary, CrosswalkSummary, FecRunSummary } from '@civicscope/cms';
import type { IngestSource } from '@civicscope/core';

/** How each automated source's runs are named and summed up in one line. */
export function runTitle(source: IngestSource, params: unknown): string {
  const p = (params ?? {}) as { cycle?: number; congress?: number };
  switch (source) {
    case 'fec':
      return `FEC ${p.cycle}`;
    case 'congress_legislators':
      return 'Congress ID crosswalk';
    case 'congress_gov':
      return `Congress.gov, ${p.congress}th Congress`;
  }
}

export function runResult(source: IngestSource, summary: unknown): string {
  if (!summary) return '—';
  switch (source) {
    case 'fec': {
      const s = summary as FecRunSummary;
      return `${s.counts.create} new, ${s.counts.add_to_race} added, ${s.counts.update} updated, ${s.counts.unchanged} unchanged, ${s.counts.conflicts} conflicts`;
    }
    case 'congress_legislators': {
      const s = summary as CrosswalkSummary;
      return `${s.created} new people, ${s.linked} linked, ${s.unchanged} unchanged`;
    }
    case 'congress_gov': {
      const s = summary as CongressRunSummary;
      const t = (x: { created: number; updated: number }, one: string, many: string) => {
        const n = x.created + x.updated;
        return `${n} ${n === 1 ? one : many} changed`;
      };
      return [
        s.parts.includes('members') && t(s.members, 'member', 'members'),
        s.parts.includes('bills') && t(s.bills, 'bill', 'bills'),
        s.parts.includes('house-votes') && t(s.votes, 'House vote', 'House votes'),
        s.stoppedEarly && 'stopped early',
      ]
        .filter(Boolean)
        .join(', ');
    }
  }
}

export function needsPerson(source: IngestSource, summary: unknown): number | null {
  if (!summary) return null;
  if (source === 'congress_gov') {
    const s = summary as CongressRunSummary;
    return s.attention.length + s.unmatched.length;
  }
  return (summary as { attention: unknown[] }).attention.length;
}
