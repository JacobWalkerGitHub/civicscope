import type { Metadata } from 'next';
import Link from 'next/link';
import { listCorrectionRequests } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { CORRECTION_STATE_LABELS } from './labels';

export const metadata: Metadata = { title: 'Corrections · CivicScope admin' };

type Search = Record<string, string | string[] | undefined>;

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Requests can include a reader's email, so viewers don't see them.
  await requirePermission('content:edit');
  const open = (await searchParams).show !== 'resolved';
  const rows = await listCorrectionRequests(getDb(), { open });
  return (
    <>
      <div className="page-header">
        <h1>Correction requests</h1>
      </div>
      <nav className="tabs" aria-label="Which requests">
        <Link href="/admin/corrections" aria-current={open ? 'page' : undefined}>
          Open
        </Link>
        <Link href="/admin/corrections?show=resolved" aria-current={open ? undefined : 'page'}>
          Resolved
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="muted">{open ? 'No open requests.' : 'No resolved requests yet.'}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Sent</th>
              <th scope="col">Page</th>
              <th scope="col">Request</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/corrections/${r.id}`}>{dateTime.format(r.submittedAt)}</Link>
                </td>
                <td>{r.pagePath ?? '—'}</td>
                <td>
                  {r.description.length > 120 ? `${r.description.slice(0, 120)}…` : r.description}
                </td>
                <td>{CORRECTION_STATE_LABELS[r.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
