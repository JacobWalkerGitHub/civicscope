import Link from 'next/link';
import { listUpcomingPublicRaces } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

// Reads the database on every request, so publishing in the admin shows up at once.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const races = await listUpcomingPublicRaces(getDb());
  const byElection = new Map<string, typeof races>();
  for (const r of races) {
    const key = `${r.electionDate}|${r.electionName}`;
    byElection.set(key, [...(byElection.get(key) ?? []), r]);
  }
  return (
    <>
      <h1>Upcoming races</h1>
      <p>
        A nonpartisan directory of candidates for federal and state office. Every fact links to its
        source.
      </p>
      {races.length === 0 ? (
        <p className="notice">No upcoming races are published yet.</p>
      ) : (
        [...byElection].map(([key, list]) => (
          <section key={key} aria-label={list[0]!.electionName}>
            <h2>
              {list[0]!.electionName}{' '}
              <span className="muted">· {formatDate(list[0]!.electionDate)}</span>
            </h2>
            <ul className="race-list">
              {list.map((r) => (
                <li key={r.id}>
                  <Link href={`/races/${r.id}`}>{r.name}</Link>{' '}
                  <span className="muted">
                    · {Number(r.candidateCount)} candidate
                    {Number(r.candidateCount) === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
