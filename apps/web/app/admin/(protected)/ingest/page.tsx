import type { Metadata } from 'next';
import Link from 'next/link';
import { listIngestRuns, type FecRunSummary } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Automated imports · CivicScope admin' };

const RUN_STATE_LABELS = {
  running: 'Running',
  succeeded: 'Finished',
  failed: 'Failed',
} as const;

export default async function IngestPage() {
  await requirePermission('admin:view');
  const runs = await listIngestRuns(getDb());
  return (
    <>
      <h1>Automated imports</h1>
      <p className="muted">
        Runs that load federal candidates from the FEC. They create drafts only: nothing is
        published until a reviewer publishes it. Fields someone changed by hand are never
        overwritten, and possible duplicates wait for a person.
      </p>
      <p className="hint">
        Start a run from the server with <code>pnpm ingest:fec 2028</code> (it needs{' '}
        <code>FEC_API_KEY</code>). Scheduled runs come with hosting.
      </p>
      {runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Source</th>
              <th scope="col">State</th>
              <th scope="col">Result</th>
              <th scope="col">Needs a person</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = r.summary as FecRunSummary | null;
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/ingest/${r.id}`}>{dateTime.format(r.startedAt)}</Link>
                  </td>
                  <td>FEC {(r.params as { cycle?: number }).cycle}</td>
                  <td>{RUN_STATE_LABELS[r.state]}</td>
                  <td>
                    {r.state === 'failed'
                      ? r.error
                      : s
                        ? `${s.counts.create} new, ${s.counts.add_to_race} added, ${s.counts.update} updated, ${s.counts.unchanged} unchanged, ${s.counts.conflicts} conflicts`
                        : '—'}
                  </td>
                  <td>{s ? s.attention.length : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
