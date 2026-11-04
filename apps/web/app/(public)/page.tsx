import Link from 'next/link';
import {
  billOverview,
  listCurrentMembers,
  listPublicBills,
  listUpcomingPublicRaces,
} from '@civicscope/cms';
import { DateTile, StageBadge, countdown } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

// Reads the database on every request, so publishing in the admin shows up at once.
export const dynamic = 'force-dynamic';

/** Races shown per election before "See all". Legislatures have a hundred or more. */
const RACES_PER_ELECTION = 8;

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
  // Bills and members are extras: never let them take the home page down.
  const [races, overview, recent, moving, members] = await Promise.all([
    listUpcomingPublicRaces(db),
    billOverview(db).catch(() => null),
    listPublicBills(db, { tab: 'outcomes' }).catch(() => null),
    listPublicBills(db, { tab: 'progress' }).catch(() => null),
    listCurrentMembers(db).catch(() => null),
  ]);
  const byElection = new Map<number, typeof races>();
  for (const r of races) byElection.set(r.electionId, [...(byElection.get(r.electionId) ?? []), r]);
  const elections = [...byElection.values()];
  const candidates = races.reduce((n, r) => n + Number(r.candidateCount), 0);

  const explore = [
    {
      href: '/elections',
      title: 'Elections',
      text: 'Dates, deadlines and every race on the ballot.',
      stat: elections.length ? `${plural(elections.length, 'upcoming election')}` : null,
    },
    {
      href: '/politicians',
      title: 'Politicians',
      text: 'Who holds office now, and everyone who has run.',
      stat: members?.rows.length ? `${plural(members.rows.length, 'member')} of Congress` : null,
    },
    {
      href: '/bills',
      title: 'Bills',
      text: 'What passed, what failed, and how each member voted.',
      stat: overview?.total ? `${overview.total.toLocaleString('en-US')} bills` : null,
    },
    {
      href: '/issues',
      title: 'Issues',
      text: 'Candidates’ stated positions, side by side, with sources.',
      stat: null,
    },
  ];

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">Nonpartisan · Source-backed</p>
        <h1 id="home-title">See who represents you, what they do, and how we know it.</h1>
        <p className="hero-lede">
          Candidates, officeholders and the bills they vote on, in one place. Every fact links to
          its source, and everyone is listed in alphabetical order.
        </p>
        <form action="/search" role="search" className="hero-search">
          <label htmlFor="home-q" className="visually-hidden">
            Search by name, office, state, district or issue
          </label>
          <input id="home-q" type="search" name="q" placeholder="Search names, offices, issues" />
          <button type="submit">Search</button>
        </form>
        <p className="hero-alt">
          <Link href="/ballot">Find what’s on your ballot by address →</Link>
        </p>
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
          </dl>
        )}
      </section>

      <nav aria-label="Explore CivicScope" className="explore-grid">
        {explore.map((e) => (
          <Link key={e.href} href={e.href} className="explore-card">
            <span className="explore-title">{e.title}</span>
            <span className="explore-text">{e.text}</span>
            {e.stat && <span className="explore-stat">{e.stat}</span>}
            <span className="explore-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </nav>

      <div className="section-heading">
        <h2>Upcoming elections</h2>
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

      {recent?.rows.length || moving?.rows.length ? (
        <div className="home-bills">
          {[
            { key: 'recent', title: 'Recently passed or failed', data: recent, href: '/bills' },
            {
              key: 'moving',
              title: 'Moving in Congress',
              data: moving,
              href: '/bills?tab=progress',
            },
          ].map((col) =>
            col.data && col.data.rows.length > 0 ? (
              <section key={col.key} aria-labelledby={`hb-${col.key}`} className="card">
                <div className="section-heading">
                  <h2 id={`hb-${col.key}`}>{col.title}</h2>
                  <Link href={col.href}>See all →</Link>
                </div>
                <ul className="mini-bills">
                  {col.data.rows.slice(0, 5).map((b) => (
                    <li key={b.id}>
                      <div className="bill-card-top">
                        <span className="bill-number">{b.label}</span>
                        <StageBadge stage={b.stage} />
                      </div>
                      <Link href={`/bills/${b.congress}/${b.billType}/${b.number}`}>{b.title}</Link>
                      {b.latestActionOn && (
                        <span className="muted small">{formatDate(b.latestActionOn)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      ) : null}

      <section className="explainer" aria-labelledby="how-title">
        <h2 id="how-title">How CivicScope works</h2>
        <ul>
          <li>
            <strong>Sourced.</strong> Every claim cites an official record, filing or the
            candidate’s own words, with a link you can check.
          </li>
          <li>
            <strong>Even-handed.</strong> People appear in alphabetical order, with the same fields
            for everyone and no party colors.
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
