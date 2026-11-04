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
import { Chip, WhenChip } from './badges';
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
  const decided = races.filter((r) => r.won.length + r.advanced.length > 0).length;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Election day joins the deadlines; the first date not yet past is "next".
  const timeline = [
    ...deadlines.map((d) => ({
      key: `d${d.id}`,
      date: d.date,
      what: DEADLINE_KIND_LABELS[d.kind],
      label: d.label,
      url: d.sourceUrl as string | null,
    })),
    { key: 'day', date: e.date, what: 'Election day', label: null, url: e.officialUrl },
  ].sort((a, b) => a.date.localeCompare(b.date));
  const next = timeline.find((t) => t.date >= today)?.key;
  return (
    <>
      <header className="page-hero">
        <p className="eyebrow">
          {ELECTION_TYPE_LABELS[e.type]} · {e.jurisdictionName}
        </p>
        <h1>
          {e.name} <NotPublic state={e.publishState} />
        </h1>
        <p className="page-hero-meta">
          <WhenChip date={e.date} />
          <Chip>{formatDate(e.date)}</Chip>
          <Chip>
            {races.length} {races.length === 1 ? 'race' : 'races'} covered
          </Chip>
          {decided > 0 && (
            <Chip>
              {decided} of {races.length} with a recorded result
            </Chip>
          )}
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
            <dt>Official source</dt>
            <dd>
              <a href={e.officialUrl} rel="noopener noreferrer" target="_blank">
                {new URL(e.officialUrl).hostname}
              </a>
            </dd>
          </>
        )}
      </dl>

      <section aria-labelledby="dates-heading">
        <h2 id="dates-heading">Key dates</h2>
        {deadlines.length === 0 && (
          <p className="muted">
            We have not recorded this election’s deadlines yet. Check the state election office.
          </p>
        )}
        <ol className="timeline">
          {timeline.map((t) => (
            <li
              key={t.key}
              className={t.key === next ? 'next' : t.date < today ? 'past' : undefined}
            >
              <span className="timeline-date">{formatDate(t.date)}</span>
              <span className="timeline-what">
                <strong>{t.what}</strong>
                {t.label && <>. {t.label}</>}
                {t.key === next && <span className="chip when upcoming">Next</span>}
              </span>
              {t.url && (
                <a href={t.url} rel="noopener noreferrer" target="_blank" className="small">
                  {new URL(t.url).hostname}
                </a>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="races-heading">
        <h2 id="races-heading">Races we cover</h2>
        {races.length === 0 ? (
          <p className="muted">
            No races in this election are published yet. That does not mean there are none: see{' '}
            <Link href="/coverage">Coverage</Link>.
          </p>
        ) : (
          groupByOffice(races).map(([title, list], gi) => (
            <div key={`${gi}-${title}`} className="race-group">
              {title && (
                <h3>
                  {title} <span className="muted">· {list.length} races</span>
                </h3>
              )}
              <ul className="race-cards">
                {list.map((r) => (
                  <li key={r.id} className={r.won.length ? 'decided' : undefined}>
                    <Link href={raceHref(r.id)} className="race-card-name">
                      {list.length > 1 && r.name.startsWith(`${title}, `)
                        ? r.name.slice(title.length + 2)
                        : r.name}
                    </Link>{' '}
                    <NotPublic state={r.publishState} />
                    {r.won.length > 0 ? (
                      <span className="race-card-meta">
                        <span className="status-badge tone-won">✓ Won</span> {r.won.join(', ')}
                      </span>
                    ) : r.advanced.length > 0 ? (
                      <span className="race-card-meta">
                        <span className="status-badge tone-advanced">Advanced</span>{' '}
                        {r.advanced.join(', ')}
                      </span>
                    ) : (
                      <span className="race-card-meta muted">
                        {r.candidates === 0
                          ? 'No candidates published yet'
                          : `${r.candidates} ${r.candidates === 1 ? 'candidate' : 'candidates'}`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
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

/**
 * Races grouped by office, in the order they arrive (a legislature has a hundred or
 * more). Offices with one race each are gathered into one grid, so a page of single
 * races reads as one set of cards rather than a column of one-card groups.
 */
function groupByOffice<T extends { officeTitle: string }>(races: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of races) groups.set(r.officeTitle, [...(groups.get(r.officeTitle) ?? []), r]);
  const out: [string, T[]][] = [];
  for (const [title, list] of groups) {
    const last = out.at(-1);
    if (list.length === 1 && last && last[1].length > 0 && last[0] === '') last[1].push(list[0]!);
    else out.push([list.length === 1 ? '' : title, list]);
  }
  return out;
}
