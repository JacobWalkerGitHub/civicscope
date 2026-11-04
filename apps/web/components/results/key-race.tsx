import { reportingShare, type ResultContestView } from '@civicscope/cms';
import { fmt, partySide, reportingText } from './format';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('');

/** A big, at-a-glance card for one race: who leads, by how much, and how much is counted. */
export function KeyRace({ contest }: { contest: ResultContestView }) {
  const share = reportingShare(contest);
  const counting = contest.totalVotes > 0;
  const top = contest.candidates[0];
  const tied = counting && contest.candidates[1]?.votes === top?.votes;
  return (
    <div className="key-race">
      <ol className="key-cands">
        {contest.candidates.map((c, i) => {
          const p = counting ? (c.votes / contest.totalVotes) * 100 : 0;
          return (
            <li key={c.key} className={`side-${partySide(c.party)}`}>
              <span className="key-avatar" aria-hidden="true">
                {initials(c.name)}
              </span>
              <span className="key-who">
                <span className="key-name">
                  {c.name}
                  {i === 0 && counting && !tied && <span className="lead-tag">Leading</span>}
                </span>
                <span className="key-party">{c.party ?? 'No party'}</span>
              </span>
              <span className="key-nums">
                <span className="key-pct">{counting ? `${p.toFixed(1)}%` : '–'}</span>
                <span className="key-votes">{fmt(c.votes)} votes</span>
              </span>
              <span className="key-bar" aria-hidden="true">
                <span style={{ width: `${p}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="key-reporting">
        <span className="reporting-bar" aria-hidden="true">
          <span style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
        </span>
        <strong>{share === null ? '–' : `${Math.round(share * 100)}%`}</strong> of precincts
        reporting · {reportingText(contest)} · {fmt(contest.totalVotes)} votes counted
      </p>
    </div>
  );
}
