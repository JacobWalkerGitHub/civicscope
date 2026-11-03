import Link from 'next/link';
import type { getPublicElection } from '@civicscope/cms';
import {
  DEADLINE_KIND_LABELS,
  ELECTION_TYPE_LABELS,
  formatDate,
  PRIMARY_SYSTEM_EXPLANATIONS,
  PRIMARY_SYSTEM_LABELS,
  RESOURCE_KIND_LABELS,
} from '@/lib/labels';
import { NotPublic, ReportLink } from './sources';

type ElectionPage = NonNullable<Awaited<ReturnType<typeof getPublicElection>>>;

/** One election: when it is, how it works, its key dates and where to get official help. */
export function ElectionOverview({
  page,
  raceHref,
  electionHref,
}: {
  page: ElectionPage;
  raceHref: (id: number) => string;
  electionHref: (id: number) => string;
}) {
  const { election: e, deadlines, races, resources, related } = page;
  return (
    <>
      <header className="profile-header">
        <h1>
          {e.name} <NotPublic state={e.publishState} />
        </h1>
        <p>
          {formatDate(e.date)} · {e.jurisdictionName}
        </p>
      </header>
      <dl className="facts">
        <dt>Election</dt>
        <dd>{ELECTION_TYPE_LABELS[e.type]}</dd>
        {e.primarySystem !== 'not_applicable' && (
          <>
            <dt>How it works</dt>
            <dd>
              {PRIMARY_SYSTEM_LABELS[e.primarySystem]}.{' '}
              {PRIMARY_SYSTEM_EXPLANATIONS[e.primarySystem]}
            </dd>
          </>
        )}
        {e.officialUrl && (
          <>
            <dt>Official information</dt>
            <dd>
              <a href={e.officialUrl} rel="noopener noreferrer" target="_blank">
                Election office page
              </a>
            </dd>
          </>
        )}
      </dl>

      <section aria-labelledby="dates-heading">
        <h2 id="dates-heading">Key dates</h2>
        {deadlines.length === 0 ? (
          <p className="muted">
            We have not recorded this election’s deadlines yet. Check the state election office.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    <strong>{DEADLINE_KIND_LABELS[d.kind]}</strong>
                    {d.label && <>. {d.label}</>}
                  </td>
                  <td>
                    <a href={d.sourceUrl} rel="noopener noreferrer" target="_blank">
                      {new URL(d.sourceUrl).hostname}
                    </a>
                  </td>
                </tr>
              ))}
              <tr>
                <td>{formatDate(e.date)}</td>
                <td>
                  <strong>Election day</strong>
                </td>
                <td>
                  {e.officialUrl && (
                    <a href={e.officialUrl} rel="noopener noreferrer" target="_blank">
                      {new URL(e.officialUrl).hostname}
                    </a>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="races-heading">
        <h2 id="races-heading">Races we cover</h2>
        {races.length === 0 ? (
          <p className="muted">
            No races in this election are published yet. That does not mean there are none: see{' '}
            <Link href="/coverage">Coverage</Link>.
          </p>
        ) : (
          <ul className="race-list">
            {races.map((r) => (
              <li key={r.id}>
                <Link href={raceHref(r.id)}>{r.name}</Link> <NotPublic state={r.publishState} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {related.length > 0 && (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading">Other {e.jurisdictionName} elections this year</h2>
          <ul>
            {related.map((r) => (
              <li key={r.id}>
                <Link href={electionHref(r.id)}>{r.name}</Link>, {formatDate(r.date)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="official-heading">
        <h2 id="official-heading">Official {e.jurisdictionName} resources</h2>
        {resources.length === 0 ? (
          <p className="muted">No official links recorded yet.</p>
        ) : (
          <ul>
            {resources.map((r) => (
              <li key={r.id}>
                {RESOURCE_KIND_LABELS[r.kind]}:{' '}
                <a href={r.url} rel="noopener noreferrer" target="_blank">
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ReportLink path={`/elections/${e.id}`} />
    </>
  );
}
