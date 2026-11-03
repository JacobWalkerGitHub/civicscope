import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicElections, listPublicElectionYears } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { DEADLINE_KIND_LABELS, ELECTION_TYPE_LABELS, formatDate } from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Election calendar · CivicScope',
  description:
    'Upcoming election dates and deadlines in the states CivicScope covers, each linked to the official source.',
};

// Reads the database on every request, so publishing in the admin shows up at once.
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const monthName = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 7)}-01T00:00:00Z`),
  );

export default async function ElectionCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const db = getDb();
  const years = await listPublicElectionYears(db);
  const raw = one(sp.year);
  const year = /^\d{4}$/.test(raw) && years.includes(Number(raw)) ? Number(raw) : undefined;
  const elections = await listPublicElections(db, { year });
  const byMonth = new Map<string, typeof elections>();
  for (const e of elections) {
    const key = e.date.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
  }

  return (
    <>
      <h1>Election calendar</h1>
      <p>
        Election days and the deadlines that lead up to them, in the states CivicScope covers. Every
        date links to the official document that sets it. Dates can change, so check with your
        state’s election office before you rely on one. This calendar lists only what we cover: see{' '}
        <Link href="/coverage">Coverage</Link>.
      </p>
      {years.length > 0 && (
        <nav aria-label="Calendar years" className="filters">
          <span>Show: </span>
          <Link href="/elections" aria-current={year ? undefined : 'page'}>
            Upcoming
          </Link>
          {years.map((y) => (
            <span key={y}>
              {' · '}
              <Link href={`/elections?year=${y}`} aria-current={year === y ? 'page' : undefined}>
                {y}
              </Link>
            </span>
          ))}
        </nav>
      )}
      {elections.length === 0 ? (
        <p className="notice">
          {year
            ? `No ${year} elections are published.`
            : 'No upcoming elections are published yet.'}
        </p>
      ) : (
        [...byMonth].map(([month, list]) => (
          <section key={month} aria-labelledby={`m-${month}`}>
            <h2 id={`m-${month}`}>{monthName(month)}</h2>
            <ul className="race-list">
              {list.map((e) => (
                <li key={e.id}>
                  <h3>
                    <Link href={`/elections/${e.id}`}>{e.name}</Link>
                  </h3>
                  <p>
                    {formatDate(e.date)} · {e.jurisdictionName} · {ELECTION_TYPE_LABELS[e.type]}
                    {e.raceCount > 0 && (
                      <>
                        {' '}
                        · {e.raceCount} race{e.raceCount === 1 ? '' : 's'} covered
                      </>
                    )}
                  </p>
                  {e.deadlines.length > 0 && (
                    <ul>
                      {e.deadlines.map((d) => (
                        <li key={d.id}>
                          {formatDate(d.date)}: {DEADLINE_KIND_LABELS[d.kind]}{' '}
                          <a href={d.sourceUrl} rel="noopener noreferrer" target="_blank">
                            (source)
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
