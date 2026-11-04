import type {
  CongressRunSummary,
  CrosswalkSummary,
  FecRunSummary,
  FecTotalsSummary,
  OpenStatesSummary,
  StateOfficialsSummary,
} from '@civicscope/cms';
import type { IngestSource } from '@civicscope/core';

/** How each automated source's runs are named and summed up in one line. */
export function runTitle(source: IngestSource, params: unknown): string {
  const p = (params ?? {}) as { cycle?: number; congress?: number; parts?: string[] };
  switch (source) {
    case 'fec':
      return `FEC ${p.cycle}`;
    case 'congress_legislators':
      return 'Congress ID crosswalk';
    case 'congress_gov': {
      const parts = p.parts ?? [];
      const senate = parts.includes('senate-votes');
      const gov = parts.some((x) => x !== 'senate-votes');
      const where = senate ? (gov ? 'Congress.gov and Senate.gov' : 'Senate.gov') : 'Congress.gov';
      return `${where}, ${p.congress}th Congress`;
    }
    case 'state_results':
      return `Live results (${((params as { states?: string[] })?.states ?? []).join(', ')})`;
    case 'fec_totals':
      return `FEC money totals, ${(params as { cycle?: number })?.cycle}`;
    case 'openstates':
      return `Open States (${((params as { states?: string[] })?.states ?? []).join(', ')})`;
    case 'state_officials': {
      const n = ((params as { states?: string[] })?.states ?? []).length;
      return `Governors and state legislators (${n} ${n === 1 ? 'state' : 'states'})`;
    }
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
        s.parts.includes('senate-votes') &&
          s.senateVotes &&
          t(s.senateVotes, 'Senate vote', 'Senate votes'),
        s.stoppedEarly && 'stopped early',
      ]
        .filter(Boolean)
        .join(', ');
    }
    case 'state_results':
      // Live results were removed; old runs still list here.
      return (summary as { state: string; outcome: string }[])
        .map((f) => `${f.state} ${f.outcome}`)
        .join('; ');
    case 'fec_totals': {
      const s = summary as FecTotalsSummary;
      return `${s.stored} totals stored, ${s.missing} with nothing filed, ${s.outsideRows ?? 0} outside-spending rows`;
    }
    case 'openstates': {
      const s = summary as OpenStatesSummary;
      const votes = s.states.reduce((n, x) => n + x.votes, 0);
      return `${s.created} new people, ${s.linked} linked, ${votes} votes read`;
    }
    case 'state_officials': {
      const s = summary as StateOfficialsSummary;
      const sum = (k: 'added' | 'updated' | 'left') => s.states.reduce((n, x) => n + x[k], 0);
      const govs = s.states.filter((x) => x.governor).length;
      const legs = s.states.reduce((n, x) => n + x.legislators, 0);
      return `${govs} governors and ${legs} legislators read: ${sum('added')} added, ${sum('updated')} changed, ${sum('left')} left office`;
    }
  }
}

export function needsPerson(source: IngestSource, summary: unknown): number | null {
  if (!summary) return null;
  if (source === 'state_results' || source === 'fec_totals') return null;
  if (source === 'congress_gov') {
    const s = summary as CongressRunSummary;
    return s.attention.length + s.unmatched.length;
  }
  return (summary as { attention: unknown[] }).attention.length;
}
