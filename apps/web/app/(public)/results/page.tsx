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

export default async function ResultsPage() {
  const db = getDb();
  const [date] = await listResultDates(db);
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
        <p className="eyebrow">{date ? 'Live · Unofficial results' : 'Results'}</p>
        <h1 id="results-title">
          {date ? `Election results: ${formatDate(date)}` : 'Election results'}
        </h1>
        <p className="hero-lede">
          Numbers come straight from each state’s official election-night results file and update as
          the state publishes them. CivicScope does not project or call races.
        </p>
        {date && <AutoRefresh />}
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
          <UsResultsMap states={states} leads={leads} />
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
                      <Link href={`/results/${s.state.toLowerCase()}`}>{s.stateName}</Link>
                    </h2>
                    <span className="muted">
                      {s.contests} contests · updated {timeEt(s.changedAt)}
                    </span>
                  </header>
                  {headline && <ContestCard contest={headline} />}
                  <p className="see-all">
                    <Link href={`/results/${s.state.toLowerCase()}`}>
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
