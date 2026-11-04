import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicElections, listPublicElectionYears } from '@civicscope/cms';
import { DateTile, PageIntro, Tabs, countdown } from '@/components/public/ui';
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

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  return (
    <>
      <PageIntro eyebrow="Elections" title="Election calendar">
        <p>
          Election days and the deadlines that lead up to them, in the states CivicScope covers.
          Every date links to the official document that sets it. Dates can change, so check with
          your state’s election office before you rely on one. This calendar lists only what we
          cover: see <Link href="/coverage">Coverage</Link>.
        </p>
      </PageIntro>
      {years.length > 0 && (
        <Tabs
          label="Calendar years"
          items={[
            { href: '/elections', label: 'Upcoming', current: !year },
            ...years.map((y) => ({
              href: `/elections?year=${y}`,
              label: String(y),
              current: year === y,
            })),
          ]}
        />
      )}
      {elections.length === 0 ? (
        <p className="notice">
          {year
            ? `No ${year} elections are published.`
            : 'No upcoming elections are published yet.'}
        </p>
      ) : (
        [...byMonth].map(([month, list]) => (
          <section key={month} aria-labelledby={`m-${month}`} className="cal-month">
            <h2 id={`m-${month}`}>{monthName(month)}</h2>
            <div className="election-cards">
              {list.map((e) => (
                <section key={e.id} className="election-card" aria-labelledby={`e-${e.id}`}>
                  <header className="election-card-head">
                    <DateTile iso={e.date} />
                    <div>
                      <h3 id={`e-${e.id}`}>
                        <Link href={`/elections/${e.id}`}>{e.name}</Link>
                      </h3>
                      <p className="muted">
                        {formatDate(e.date)} · {e.jurisdictionName} · {ELECTION_TYPE_LABELS[e.type]}
                        {e.date >= today && (
                          <>
                            {' '}
                            <span className="pill">{countdown(e.date)}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </header>
                  {e.deadlines.length > 0 ? (
                    <ol className="cal-dates" aria-label={`Key dates for ${e.name}`}>
                      {e.deadlines.map((d) => {
                        const what = DEADLINE_KIND_LABELS[d.kind];
                        // The description is the state's own wording; skip it when it only
                        // repeats the kind of date.
                        const detail =
                          d.label && d.label.toLowerCase() !== what.toLowerCase() ? d.label : null;
                        return (
                          <li key={d.id} className={d.date < today ? 'past' : undefined}>
                            <span className="cal-date">{formatDate(d.date)}</span>
                            <span className="cal-what">
                              <strong>{d.kind === 'other' && detail ? detail : what}</strong>
                              {detail && d.kind !== 'other' && (
                                <span className="muted"> · {detail}</span>
                              )}
                            </span>
                            <a
                              href={d.sourceUrl}
                              rel="noopener noreferrer"
                              target="_blank"
                              className="small"
                            >
                              {new URL(d.sourceUrl).hostname}
                            </a>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="cal-empty muted small">
                      No deadlines recorded yet. Check the state election office.
                    </p>
                  )}
                  <p className="see-all">
                    <Link href={`/elections/${e.id}`}>
                      {e.raceCount > 0
                        ? `See ${e.raceCount} race${e.raceCount === 1 ? '' : 's'} covered →`
                        : 'Election details →'}
                    </Link>
                  </p>
                </section>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
