import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIngestRun, type FecRunSummary, type ImportSummary } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Automated import run · CivicScope admin' };

const STATE_LABELS = { running: 'Running', succeeded: 'Finished', failed: 'Failed' } as const;

export default async function IngestRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('admin:view');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getIngestRun(getDb(), id);
  if (!detail) notFound();
  const { run, batches, pages } = detail;
  const s = run.summary as FecRunSummary | null;
  const cycle = (run.params as { cycle?: number }).cycle;
  return (
    <>
      <p>
        <Link href="/admin/ingest">← Automated imports</Link>
      </p>
      <div className="page-header">
        <h1>
          FEC {cycle} import, {dateTime.format(run.startedAt)}
        </h1>
        <span className="badge">{STATE_LABELS[run.state]}</span>
      </div>
      {run.error && (
        <p className="alert" role="alert">
          {run.error}
        </p>
      )}
      {s && (
        <dl className="facts">
          <dt>Fetched</dt>
          <dd>
            {s.fetched} registrations on {pages} page{pages === 1 ? '' : 's'}
            {s.skippedInactive > 0 && <>, {s.skippedInactive} inactive skipped</>}
          </dd>
          <dt>Races</dt>
          <dd>
            {s.races} races, {s.racesChanged} with changes
          </dd>
          <dt>Candidates</dt>
          <dd>
            {s.counts.create} new, {s.counts.add_to_race} added to a race, {s.counts.update}{' '}
            updated, {s.counts.unchanged} unchanged
          </dd>
          <dt>Conflicts</dt>
          <dd>
            {s.counts.conflicts > 0 ? (
              <Link href="/admin/review">{s.counts.conflicts} in the review queue</Link>
            ) : (
              'None'
            )}
          </dd>
        </dl>
      )}

      {s && s.unknownPartyCodes.length > 0 && (
        <section aria-labelledby="parties-heading">
          <h2 id="parties-heading">Party codes with no party</h2>
          <p>
            These candidates were imported without a party. Add a party with each FEC code on the{' '}
            <Link href="/admin/parties">Parties page</Link>, and the next run fills it in:{' '}
            {s.unknownPartyCodes.map((c, i) => (
              <span key={c}>
                {i > 0 && ', '}
                <code>{c}</code>
              </span>
            ))}
            .
          </p>
        </section>
      )}

      {s && (
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
          {s.attention.length === 0 ? (
            <p className="muted">Nothing.</p>
          ) : (
            <>
              <p className="hint">
                These registrations were not imported. For a possible duplicate, add the FEC ID to
                the right person (on their page, under identifiers) and the next run links them.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">FEC ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Race</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {s.attention.map((a) => (
                    <tr key={a.fecId}>
                      <td>
                        <a
                          href={`https://www.fec.gov/data/candidate/${a.fecId}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.fecId}
                        </a>
                      </td>
                      <td>{a.name}</td>
                      <td>{a.race}</td>
                      <td>{a.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="changes-heading">
        <h2 id="changes-heading">Races changed ({batches.length})</h2>
        {batches.length === 0 ? (
          <p className="muted">No changes.</p>
        ) : (
          <ul>
            {batches.map((b) => {
              const sum = b.summary as ImportSummary | null;
              return (
                <li key={b.id}>
                  <Link href={`/admin/races/${b.raceId}`}>{b.raceName}</Link>{' '}
                  <span className="muted">
                    {sum &&
                      `· ${sum.create} new, ${sum.add_to_race} added, ${sum.update} updated${sum.conflicts ? `, ${sum.conflicts} conflicts` : ''}`}{' '}
                    · <Link href={`/admin/imports/${b.id}`}>details</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
