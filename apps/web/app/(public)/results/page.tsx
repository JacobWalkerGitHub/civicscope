import type { Metadata } from 'next';
import Link from 'next/link';
import { getStateResults, listResultDates, listResultStates } from '@civicscope/cms';
import { AutoRefresh } from '@/components/results/auto-refresh';
import { ContestCard } from '@/components/results/contest';
import { timeEt } from '@/components/results/format';
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
  const details = await Promise.all(
    states.map((s) => getStateResults(db, s.state, s.electionDate)),
  );

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
              Shaded by share of precincts reporting. Select a state for every race.
            </span>
          </div>
          <UsResultsMap states={states} />

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
