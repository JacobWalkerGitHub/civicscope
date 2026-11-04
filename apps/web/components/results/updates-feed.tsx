import Link from 'next/link';
import { timeEt } from './format';

const KIND_LABEL = {
  first_votes: 'First votes',
  milestone: 'Update',
  lead_change: 'Lead change',
  all_in: 'All in',
} as const;

/** The live updates feed: milestones and lead changes, newest first. */
export function UpdatesFeed({
  updates,
  hrefFor,
}: {
  updates: {
    id: number;
    state: string;
    contestId: number;
    kind: keyof typeof KIND_LABEL;
    text: string;
    createdAt: Date;
  }[];
  hrefFor: (u: { state: string; contestId: number }) => string;
}) {
  return (
    <section className="updates" aria-labelledby="updates-title">
      <div className="section-heading">
        <h2 id="updates-title">
          <span className="live-dot" aria-hidden="true" /> Live updates
        </h2>
      </div>
      {updates.length === 0 ? (
        <p className="muted">
          Updates appear here as votes come in: first returns, each quarter of precincts counted,
          and any change of leader.
        </p>
      ) : (
        <ol className="updates-list">
          {updates.map((u) => (
            <li key={u.id} className={`update-${u.kind}`}>
              <time dateTime={u.createdAt.toISOString()}>{timeEt(u.createdAt)}</time>
              <span className="update-kind">{KIND_LABEL[u.kind]}</span>
              <Link href={hrefFor(u)}>{u.text}</Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
