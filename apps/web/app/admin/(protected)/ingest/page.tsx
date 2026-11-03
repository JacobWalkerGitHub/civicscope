import type { Metadata } from 'next';
import Link from 'next/link';
import { listIngestRuns } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { needsPerson, runResult, runTitle } from './summaries';

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
        Runs that load federal candidates from the FEC, match Members of Congress to people here by
        their IDs, and load members, bills and House votes from Congress.gov and Senate votes from
        senate.gov. They create drafts only: nothing is published until a reviewer publishes it.
        Fields someone changed by hand are never overwritten, and possible duplicates wait for a
        person.
      </p>
      <p className="hint">
        Start a run from the server with <code>pnpm ingest:fec 2028</code> (needs{' '}
        <code>FEC_API_KEY</code>), <code>pnpm ingest:legislators</code>, then{' '}
        <code>pnpm ingest:congress 119</code> (needs <code>CONGRESS_API_KEY</code>, except for{' '}
        <code>--parts senate-votes</code>). Scheduled runs come with hosting.
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
              const attention = needsPerson(r.source, r.summary);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/ingest/${r.id}`}>{dateTime.format(r.startedAt)}</Link>
                  </td>
                  <td>{runTitle(r.source, r.params)}</td>
                  <td>{RUN_STATE_LABELS[r.state]}</td>
                  <td>{r.state === 'failed' ? r.error : runResult(r.source, r.summary)}</td>
                  <td>{attention ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
