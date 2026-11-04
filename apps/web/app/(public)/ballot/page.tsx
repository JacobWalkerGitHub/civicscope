import type { Metadata } from 'next';
import Link from 'next/link';
import { geocodeAddress, listBallotRaces, type AddressDistricts } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'What’s on my ballot · CivicScope',
  description: 'Enter your address to see your districts and the upcoming races on your ballot.',
  // Addresses must never end up in search engines or shared caches.
  robots: { index: false },
};

type Props = { searchParams: Promise<{ address?: string }> };

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function districtRows(d: AddressDistricts) {
  return [
    { label: 'State', value: d.stateName },
    d.county && { label: 'County', value: d.county },
    {
      label: 'U.S. House',
      value: d.congressional ? `District ${d.congressional}` : (d.congressionalName ?? 'At large'),
    },
    d.stateUpperName && {
      label: 'State Senate',
      value: d.stateUpper ? `District ${d.stateUpper}` : d.stateUpperName,
    },
    d.stateLowerName && {
      label: 'State House',
      value: d.stateLower ? `District ${d.stateLower}` : d.stateLowerName,
    },
  ].filter((x): x is { label: string; value: string } => !!x);
}

export default async function BallotPage({ searchParams }: Props) {
  const address = ((await searchParams).address ?? '').trim().slice(0, 200);
  let found: AddressDistricts | null = null;
  let failed = false;
  if (address.length >= 5) {
    try {
      found = await geocodeAddress(address);
    } catch {
      failed = true;
    }
  }
  const races = found
    ? await listBallotRaces(getDb(), {
        state: found.state,
        congressional: found.congressional,
        stateUpper: found.stateUpper,
        stateLower: found.stateLower,
      })
    : [];
  const byElection = new Map<number, typeof races>();
  for (const r of races) byElection.set(r.electionId, [...(byElection.get(r.electionId) ?? []), r]);

  return (
    <>
      <section className="hero ballot-hero" aria-labelledby="ballot-title">
        <p className="eyebrow">Your ballot</p>
        <h1 id="ballot-title">What’s on my ballot?</h1>
        <p className="hero-lede">
          Enter your home address to see your districts and the upcoming races you can vote in.
        </p>
        <form action="/ballot" method="get" role="search" className="hero-search">
          <label htmlFor="ballot-address" className="visually-hidden">
            Home address
          </label>
          <input
            id="ballot-address"
            name="address"
            type="search"
            autoComplete="street-address"
            placeholder="123 Main St, Richmond, VA 23219"
            defaultValue={address}
            required
            minLength={5}
          />
          <button type="submit">Look up</button>
        </form>
        <p className="ballot-privacy">
          Your address goes to the U.S. Census Bureau’s geocoder to find your districts. CivicScope
          doesn’t store it.
        </p>
      </section>

      {failed && (
        <p className="notice" role="alert">
          The Census Bureau’s address service didn’t answer. Please try again in a minute.
        </p>
      )}
      {address && !failed && !found && (
        <p className="notice" role="alert">
          We couldn’t find that address. Try the full street address with city and state, or a ZIP
          code. (P.O. boxes can’t be matched to a district.)
        </p>
      )}

      {found && (
        <div className="ballot-layout">
          <section className="ballot-districts" aria-labelledby="districts-title">
            <h2 id="districts-title">Your districts</h2>
            <p className="muted">{found.matchedAddress}</p>
            <dl>
              {districtRows(found).map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="muted small">
              Districts from the U.S. Census Bureau’s current maps. If your state redrew its
              districts recently, check with your local election office.
            </p>
          </section>

          <section aria-labelledby="races-title">
            <div className="section-heading">
              <h2 id="races-title">Upcoming races on your ballot</h2>
            </div>
            {races.length === 0 ? (
              <p className="notice">
                We don’t have upcoming races for {found.stateName} published yet. See the{' '}
                <Link href="/elections">election calendar</Link> for dates.
              </p>
            ) : (
              <div className="election-cards">
                {[...byElection.values()].map((list) => {
                  const first = list[0]!;
                  return (
                    <section
                      key={first.electionId}
                      className="election-card"
                      aria-label={first.electionName}
                    >
                      <header className="election-card-head">
                        <div>
                          <h3>
                            <Link href={`/elections/${first.electionId}`}>
                              {first.electionName}
                            </Link>
                          </h3>
                          <p className="muted">
                            {first.jurisdictionName} · {formatDate(first.electionDate)}
                          </p>
                        </div>
                      </header>
                      <ul className="race-rows">
                        {list.map((r) => {
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
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
