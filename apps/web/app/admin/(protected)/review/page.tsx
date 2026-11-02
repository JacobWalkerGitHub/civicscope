import type { Metadata } from 'next';
import Link from 'next/link';
import { listReviewQueue } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { CLAIM_KIND_LABELS, dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Review queue · CivicScope admin' };

export default async function ReviewPage() {
  const user = await requirePermission('admin:view');
  const queue = await listReviewQueue(getDb());
  return (
    <>
      <h1>Review queue</h1>
      <p className="muted">
        Profile entries waiting for a reviewer, oldest first. Reviewers check each one against its
        sources, then approve and publish it or send it back with a note. Nobody can approve their
        own changes except the owner.
      </p>
      {queue.length === 0 ? (
        <p className="notice">Nothing is waiting for review.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Entry</th>
              <th scope="col">Person</th>
              <th scope="col">Kind</th>
              <th scope="col">Last edited by</th>
              <th scope="col">Waiting since</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.id}>
                <td>
                  <Link href={`/admin/claims/${q.id}`}>{q.title}</Link>
                  {q.wasPublished ? (
                    <span className="muted"> (edited after publishing; currently hidden)</span>
                  ) : null}
                  {q.lastEditedBy === user.id && <span className="muted"> (your edit)</span>}
                </td>
                <td>
                  <Link href={`/admin/candidates/${q.personId}`}>{q.personName}</Link>
                </td>
                <td>
                  {CLAIM_KIND_LABELS[q.kind]}
                  {q.issueName && <span className="muted"> · {q.issueName}</span>}
                </td>
                <td>{q.editorName ?? '—'}</td>
                <td>{q.submittedAt ? dateTime.format(q.submittedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
