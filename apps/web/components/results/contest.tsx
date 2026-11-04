import Link from 'next/link';
import { reportingShare, type ResultContestView } from '@civicscope/cms';
import { fmt, pct, reportingText } from './format';

/** One contest: each candidate's votes and share, and how much of the count is in. */
export function ContestCard({
  contest,
  areasHref,
  headingLevel = 3,
}: {
  contest: Pick<
    ResultContestView,
    'name' | 'voteFor' | 'precinctsTotal' | 'precinctsReporting' | 'totalVotes' | 'candidates'
  > & { id: number; hasAreas?: boolean };
  areasHref?: string;
  headingLevel?: 2 | 3;
}) {
  const H = `h${headingLevel}` as const;
  const share = reportingShare(contest);
  const counting = contest.totalVotes > 0;
  return (
    <section className="contest" aria-label={contest.name}>
      <header className="contest-head">
        <H className="contest-name">{contest.name}</H>
        {contest.voteFor > 1 && <span className="pill">Vote for {contest.voteFor}</span>}
      </header>
      <table className={counting ? 'contest-table counting' : 'contest-table'}>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col" className="num">
              Votes
            </th>
            <th scope="col" className="num">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {contest.candidates.map((c) => {
            const p = contest.totalVotes > 0 ? (c.votes / contest.totalVotes) * 100 : 0;
            return (
              <tr key={c.key}>
                <th scope="row">
                  <span className="cand-name">{c.name}</span>
                  {c.party && <span className="cand-party">{c.party}</span>}
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${p}%` }} />
                  </span>
                </th>
                <td className="num">{fmt(c.votes)}</td>
                <td className="num">{pct(c.votes, contest.totalVotes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <footer className="contest-foot">
        <span className="reporting">
          <span className="reporting-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
          </span>
          {reportingText(contest)}
        </span>
        <span>
          {counting ? `${fmt(contest.totalVotes)} votes counted` : 'No votes reported yet'}
        </span>
        {areasHref && contest.hasAreas && <Link href={areasHref}>By county →</Link>}
      </footer>
    </section>
  );
}
