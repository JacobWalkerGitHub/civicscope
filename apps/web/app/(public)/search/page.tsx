import type { Metadata } from 'next';
import Link from 'next/link';
import { searchPublic } from '@civicscope/cms';
import { Thumb } from '@/components/public/sources';
import { getDb } from '@/lib/db';
import { CLAIM_KIND_LABELS, formatDate } from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Search · CivicScope',
  description: 'Search candidates, races, issues and sourced profile entries.',
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 200);
  const includePast = one(sp.past) === '1';
  const r = q.trim() ? await searchPublic(getDb(), q, { includePast }) : null;
  const total = r ? r.candidates.length + r.races.length + r.issues.length + r.entries.length : 0;

  return (
    <>
      <h1>Search</h1>
      <form className="filters" method="get" role="search" aria-label="Search CivicScope">
        <div className="field">
          <label htmlFor="s-q">Name, office, state, district or issue</label>
          <input id="s-q" type="search" name="q" defaultValue={q} />
        </div>
        <label className="inline">
          <input type="checkbox" name="past" value="1" defaultChecked={includePast} />
          Include past elections
        </label>
        <button type="submit">Search</button>
      </form>

      {r && (
        <p role="status">
          {total === 0
            ? `Nothing matches “${q}”${includePast ? '' : ' in upcoming elections'}.`
            : `Results for “${q}”${includePast ? '' : ' in upcoming elections'}.`}
        </p>
      )}

      {r && r.candidates.length > 0 && (
        <section aria-labelledby="sr-candidates">
          <h2 id="sr-candidates">Candidates</h2>
          <ul className="candidate-list">
            {r.candidates.map((c) => (
              <li key={c.candidacyId} className="with-thumb">
                <Thumb photoId={c.photoId} name={c.ballotName} />
                <h3>
                  <Link href={`/candidates/${c.personSlug}`}>{c.ballotName}</Link>
                </h3>
                <p>
                  <Link href={`/races/${c.raceId}`}>{c.raceName}</Link> · {c.electionName} ·{' '}
                  {formatDate(c.electionDate)}
                </p>
                <p className="muted">
                  {c.partyName ?? 'No party listed'}
                  {c.isIncumbent && ' · Incumbent'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r && r.races.length > 0 && (
        <section aria-labelledby="sr-races">
          <h2 id="sr-races">Races</h2>
          <ul>
            {r.races.map((x) => (
              <li key={x.id}>
                <Link href={`/races/${x.id}`}>{x.name}</Link>{' '}
                <span className="muted">
                  · {x.jurisdictionName} · {x.electionName} · {formatDate(x.electionDate)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r && r.issues.length > 0 && (
        <section aria-labelledby="sr-issues">
          <h2 id="sr-issues">Issues</h2>
          <ul>
            {r.issues.map((i) => (
              <li key={i.slug}>
                <Link href={`/issues/${i.slug}`}>{i.name}</Link>
                {i.description && <span className="muted"> · {i.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {r && r.entries.length > 0 && (
        <section aria-labelledby="sr-entries">
          <h2 id="sr-entries">Profile entries</h2>
          <ul>
            {r.entries.map((e) => (
              <li key={e.id}>
                <Link href={`/candidates/${e.personSlug}#entry-${e.id}`}>{e.title}</Link>{' '}
                <span className="muted">
                  · {e.personName} · {CLAIM_KIND_LABELS[e.kind]}
                  {e.issueName && <> · {e.issueName}</>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
