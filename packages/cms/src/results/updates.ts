import type { ResultGroup } from '@civicscope/core';

export interface ContestSnapshot {
  id: number;
  name: string;
  group: ResultGroup;
  precinctsTotal: number | null;
  precinctsReporting: number | null;
  totalVotes: number;
  candidates: { name: string; votes: number }[];
}

export interface UpdateLine {
  contestId: number;
  kind: 'first_votes' | 'milestone' | 'lead_change' | 'all_in';
  text: string;
}

const MILESTONES = [0.25, 0.5, 0.75];

const share = (c: ContestSnapshot) =>
  c.precinctsTotal ? (c.precinctsReporting ?? 0) / c.precinctsTotal : 0;

function standings(c: ContestSnapshot) {
  const sorted = [...c.candidates].sort(
    (a, b) => b.votes - a.votes || a.name.localeCompare(b.name),
  );
  const [first, second] = sorted;
  const margin =
    first && second && c.totalVotes > 0 ? ((first.votes - second.votes) / c.totalVotes) * 100 : 0;
  return { first, second, margin };
}

function leadText(c: ContestSnapshot) {
  const { first, second, margin } = standings(c);
  const pct = `${Math.round(share(c) * 100)}% of precincts reporting`;
  if (!first || !second || c.totalVotes === 0) return pct;
  if (first.votes === second.votes) return `${first.name} and ${second.name} are tied, ${pct}`;
  return `${first.name} leads ${second.name} by ${margin.toFixed(1)} points, ${pct}`;
}

/**
 * Plain, factual lines for the live updates feed, comparing a contest before and after a
 * read: first votes, each quarter of precincts counted, a change of leader, all precincts
 * in. Only contests on the statewide ballot and for Congress, so the feed stays readable.
 * It never says who won.
 */
export function describeUpdates(
  state: string,
  before: ContestSnapshot[],
  after: ContestSnapshot[],
): UpdateLine[] {
  const old = new Map(before.map((c) => [c.id, c]));
  const out: UpdateLine[] = [];
  const statewide = Math.max(0, ...after.map((c) => c.precinctsTotal ?? 0));
  for (const c of after) {
    const major =
      c.group === 'federal' ||
      c.group === 'statewide' ||
      (c.group === 'measure' && (c.precinctsTotal ?? 0) >= statewide * 0.9);
    if (!major || c.candidates.length < 2) continue;
    const prev = old.get(c.id);
    const title = `${state} ${c.name}`;
    if (!prev) continue;
    if (prev.totalVotes === 0 && c.totalVotes > 0) {
      out.push({
        contestId: c.id,
        kind: 'first_votes',
        text: `${title}: first votes in. ${leadText(c)}.`,
      });
      continue;
    }
    if (c.precinctsTotal && share(c) >= 1 && share(prev) < 1) {
      out.push({
        contestId: c.id,
        kind: 'all_in',
        text: `${title}: all precincts reporting. ${leadText(c)}.`,
      });
      continue;
    }
    const passed = MILESTONES.filter((m) => share(prev) < m && share(c) >= m).pop();
    const was = standings(prev).first;
    const now = standings(c).first;
    if (
      prev.totalVotes > 0 &&
      was &&
      now &&
      was.name !== now.name &&
      standings(prev).first!.votes !== standings(prev).second?.votes
    ) {
      out.push({
        contestId: c.id,
        kind: 'lead_change',
        text: `${title}: new leader. ${leadText(c)}.`,
      });
    } else if (passed) {
      out.push({ contestId: c.id, kind: 'milestone', text: `${title}: ${leadText(c)}.` });
    }
  }
  return out;
}
