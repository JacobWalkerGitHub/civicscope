import Link from 'next/link';
import { FEED_ACTIVE_DAYS, listResultDates, listUpcomingPublicRaces } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

// Reads the database on every request, so publishing in the admin shows up at once.
export const dynamic = 'force-dynamic';

/** Races shown per election before "See all". Legislatures have a hundred or more. */
const RACES_PER_ELECTION = 8;

function daysUntil(iso: string): number {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - start) / 86_400_000);
}

function countdown(iso: string): string {
  const d = daysUntil(iso);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 60) return `In ${d} days`;
  const months = Math.round(d / 30.44);
  return `In about ${months} months`;
}

function DateTile({ iso }: { iso: string }) {
  const date = new Date(`${iso}T12:00:00Z`);
  return (
    <span className="date-tile" aria-hidden="true">
      <span className="date-tile-month">
        {date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}
      </span>
      <span className="date-tile-day">{date.getUTCDate()}</span>
      <span className="date-tile-year">{date.getUTCFullYear()}</span>
    </span>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summarizeOffices(list: { officeTitle: string; candidateCount: number | string }[]) {
  const out = new Map<string, { title: string; races: number; candidates: number }>();
  for (const r of list) {
    const o = out.get(r.officeTitle) ?? { title: r.officeTitle, races: 0, candidates: 0 };
    o.races++;
    o.candidates += Number(r.candidateCount);
    out.set(r.officeTitle, o);
  }
  return [...out.values()];
}

export default async function HomePage() {
  const db = getDb();
  const [races, [resultsDate]] = await Promise.all([
    listUpcomingPublicRaces(db),
    listResultDates(db),
  ]);
  const liveResults = resultsDate && -daysUntil(resultsDate) < FEED_ACTIVE_DAYS;
  const byElection = new Map<number, typeof races>();
  for (const r of races) byElection.set(r.electionId, [...(byElection.get(r.electionId) ?? []), r]);
  const elections = [...byElection.values()];
  const candidates = races.reduce((n, r) => n + Number(r.candidateCount), 0);
  const states = new Set(races.map((r) => r.jurisdictionName)).size;

  return (
    <>
      {liveResults && (
        <p className="live-banner">
          <span>
            <span className="live-dot" aria-hidden="true" /> Live results: {formatDate(resultsDate)}
          </span>
          <Link href="/results">See live results by state →</Link>
        </p>
      )}
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Nonpartisan · Source-backed</p>
        <h1 id="home-title">Know who’s on your ballot, and how we know it.</h1>
        <p className="hero-lede">
          CivicScope tracks candidates for federal and state office. Every fact links to its source,
          and every candidate is listed in alphabetical order.
        </p>
        <form action="/search" role="search" className="hero-search">
          <label htmlFor="home-q" className="visually-hidden">
            Search by name, office, state, district or issue
          </label>
          <input id="home-q" type="search" name="q" placeholder="Search names, offices, issues" />
          <button type="submit">Search</button>
        </form>
        {races.length > 0 && (
          <dl className="hero-stats">
            <div>
              <dt>Upcoming elections</dt>
              <dd>{elections.length}</dd>
            </div>
            <div>
              <dt>Races</dt>
              <dd>{races.length}</dd>
            </div>
            <div>
              <dt>Candidates</dt>
              <dd>{candidates}</dd>
            </div>
            <div>
              <dt>{states === 1 ? 'State' : 'States'}</dt>
              <dd>{states}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="section-heading">
        <h2>Upcoming races</h2>
        <Link href="/elections">Full election calendar →</Link>
      </div>

      {races.length === 0 ? (
        <p className="notice">No upcoming races are published yet.</p>
      ) : (
        <div className="election-cards">
          {elections.map((list) => {
            const first = list[0]!;
            const withCandidates = list.filter((r) => Number(r.candidateCount) > 0);
            // A legislature has a hundred or more races: summarize it by office, then list
            // whichever races already have candidates.
            const big = list.length > RACES_PER_ELECTION;
            const shown = (big ? withCandidates : list).slice(0, RACES_PER_ELECTION);
            const offices = big ? summarizeOffices(list) : [];
            return (
              <section
                key={first.electionId}
                className="election-card"
                aria-label={first.electionName}
              >
                <header className="election-card-head">
                  <DateTile iso={first.electionDate} />
                  <div>
                    <h3>
                      <Link href={`/elections/${first.electionId}`}>{first.electionName}</Link>
                    </h3>
                    <p className="muted">
                      {first.jurisdictionName} · {formatDate(first.electionDate)} ·{' '}
                      <span className="pill">{countdown(first.electionDate)}</span>
                    </p>
                  </div>
                </header>
                {offices.length > 0 && (
                  <ul className="office-rows">
                    {offices.map((o) => (
                      <li key={o.title}>
                        <span className="office-title">{o.title}</span>
                        <span className="count">
                          {plural(o.races, 'race')} ·{' '}
                          {o.candidates > 0
                            ? plural(o.candidates, 'candidate')
                            : 'no candidates yet'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {shown.length > 0 && (
                  <ul className="race-rows">
                    {shown.map((r) => {
                      const n = Number(r.candidateCount);
                      return (
                        <li key={r.id}>
                          <Link href={`/races/${r.id}`}>{r.name}</Link>
                          <span className={n > 0 ? 'count' : 'count count-empty'}>
                            {n > 0 ? plural(n, 'candidate') : 'No candidates yet'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {list.length > shown.length && (
                  <p className="see-all">
                    <Link href={`/elections/${first.electionId}`}>
                      See all {list.length} races →
                    </Link>
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      <section className="explainer" aria-labelledby="how-title">
        <h2 id="how-title">How CivicScope works</h2>
        <ul>
          <li>
            <strong>Sourced.</strong> Every claim cites an official record, filing or the
            candidate’s own words, with a link you can check.
          </li>
          <li>
            <strong>Even-handed.</strong> Candidates appear in alphabetical order, with the same
            fields for everyone.
          </li>
          <li>
            <strong>Correctable.</strong> Spot a mistake? Every page has a link to report it, and we
            publish what we change.
          </li>
        </ul>
        <p>
          <Link href="/methodology">Read how we work →</Link>
        </p>
      </section>
    </>
  );
}
