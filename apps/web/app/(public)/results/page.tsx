import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getStateResults,
  listResultDates,
  listResultStates,
  listResultUpdates,
} from '@civicscope/cms';
import { AutoRefresh } from '@/components/results/auto-refresh';
import { ContestCard } from '@/components/results/contest';
import { leaderClass, timeEt } from '@/components/results/format';
import { UpdatesFeed } from '@/components/results/updates-feed';
import { UsResultsMap } from '@/components/results/us-map';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Live results · CivicScope',
  description:
    'Unofficial election results, read straight from each state’s official results file.',
};

type Props = { searchParams: Promise<{ date?: string }> };

export default async function ResultsPage({ searchParams }: Props) {
  const db = getDb();
  const dates = await listResultDates(db);
  const asked = (await searchParams).date;
  // An earlier election night when asked for one we have; otherwise the newest.
  const date = dates.find((d) => d === asked) ?? dates[0];
  const latest = date === dates[0];
  const q = latest ? '' : `?date=${date}`;
  const states = date ? await listResultStates(db, date) : [];
  const [details, updates] = await Promise.all([
    Promise.all(states.map((s) => getStateResults(db, s.state, s.electionDate))),
    date ? listResultUpdates(db, date) : [],
  ]);
  const leads: Record<string, string> = {};
  states.forEach((s, i) => {
    const h = details[i]?.contests.find((c) => c.id === s.headline?.id);
    if (h)
      leads[s.state] = leaderClass(
        Object.fromEntries(h.candidates.map((c) => [c.key, c.votes])),
        h.candidates,
      );
  });

  return (
    <>
      <section className="hero results-hero" aria-labelledby="results-title">
        <p className="eyebrow">
          {!date
            ? 'Results'
            : latest
              ? 'Live · Unofficial results'
              : 'Archive · Unofficial results'}
        </p>
        <h1 id="results-title">
          {date ? `Election results: ${formatDate(date)}` : 'Election results'}
        </h1>
        <p className="hero-lede">
          Numbers come straight from each state’s official election-night results file and update as
          the state publishes them. CivicScope does not project or call races.
        </p>
        {date && latest && <AutoRefresh />}
        {dates.length > 1 && (
          <nav className="result-dates" aria-label="Election nights">
            <span className="muted">Election nights:</span>
            {dates.map((d, i) => (
              <Link
                key={d}
                href={i === 0 ? '/results' : `/results?date=${d}`}
                aria-current={d === date ? 'page' : undefined}
                className={d === date ? 'result-date current' : 'result-date'}
              >
                {formatDate(d)}
              </Link>
            ))}
          </nav>
        )}
      </section>

      {!date ? (
        <p className="notice">No results have been published yet.</p>
      ) : (
        <>
          <div className="section-heading">
            <h2>Results by state</h2>
            <span className="muted">
              Colored by who leads each state’s top race. Select a state for its counties and every
              race.
            </span>
          </div>
          <UsResultsMap states={states} leads={leads} query={q} />
          <UpdatesFeed
            updates={updates}
            hrefFor={(u) => `/results/${u.state.toLowerCase()}/${u.contestId}`}
          />

          <div className="state-results">
            {states.map((s, i) => {
              const headline = details[i]?.contests.find((c) => c.id === s.headline?.id);
              return (
                <section key={s.state} className="state-result" aria-labelledby={`st-${s.state}`}>
                  <header className="state-result-head">
                    <h2 id={`st-${s.state}`}>
                      <Link href={`/results/${s.state.toLowerCase()}${q}`}>{s.stateName}</Link>
                    </h2>
                    <span className="muted">
                      {s.contests} contests · updated {timeEt(s.changedAt)}
                    </span>
                  </header>
                  {headline && <ContestCard contest={headline} />}
                  <p className="see-all">
                    <Link href={`/results/${s.state.toLowerCase()}${q}`}>
                      All {s.stateName} results →
                    </Link>
                  </p>
                </section>
              );
            })}
          </div>
          <p className="muted results-note">
            Other states are not shown yet: we only use files a state publishes for anyone to
            download, and add states as we confirm them. Results are unofficial until each state
            certifies them.
          </p>
        </>
      )}
    </>
  );
}
