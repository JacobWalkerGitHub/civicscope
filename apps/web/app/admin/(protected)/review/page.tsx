import type { Metadata } from 'next';
import Link from 'next/link';
import {
  IMPORT_FIELD_LABELS,
  listOpenConflicts,
  listParties,
  listReviewQueue,
} from '@civicscope/cms';
import { can } from '@civicscope/core';
import { ActionButton, ActionForm, TextField } from '@/components/admin/form';
import { formatImportValue } from '@/lib/imports';
import { getDb } from '@/lib/db';
import { CLAIM_KIND_LABELS, dateTime, formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { resolveConflictAction } from '../imports/actions';

export const metadata: Metadata = { title: 'Review queue · CivicScope admin' };

export default async function ReviewPage() {
  const user = await requirePermission('admin:view');
  const db = getDb();
  const [queue, conflicts, parties] = await Promise.all([
    listReviewQueue(db),
    listOpenConflicts(db),
    listParties(db, { includeArchived: true }),
  ]);
  const partyNames = new Map(parties.map((p) => [p.id, p.name]));
  const canResolve = can(user.role, 'data:import');
  return (
    <>
      <h1>Review queue</h1>
      <h2>Profile entries</h2>
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
      <section aria-labelledby="conflicts-heading">
        <h2 id="conflicts-heading">Import conflicts</h2>
        <p className="muted">
          An import’s source gave a different value for a field someone changed by hand. Check the
          source, then use its value or keep the current one. Keeping it leaves the field locked.
        </p>
        {conflicts.length === 0 ? (
          <p className="notice">No import conflicts.</p>
        ) : (
          <ul className="conflicts">
            {conflicts.map((c) => (
              <li key={c.id} className="conflict">
                <p>
                  <Link href={`/admin/candidacies/${c.candidacyId}`}>{c.ballotName}</Link>{' '}
                  <span className="muted">· {c.raceName}</span>
                </p>
                <p>
                  <strong>{IMPORT_FIELD_LABELS[c.field] ?? c.field}</strong>: now{' '}
                  <q>{formatImportValue(c.field, c.currentValue, partyNames)}</q>; the source says{' '}
                  <q>{formatImportValue(c.field, c.proposedValue, partyNames)}</q>
                  {(c.detail as { statusDate?: string } | null)?.statusDate && (
                    <> as of {formatDate((c.detail as { statusDate: string }).statusDate)}</>
                  )}
                  .
                </p>
                <p className="muted">
                  Source:{' '}
                  <a href={c.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {c.sourceTitle}
                  </a>
                  {c.importBatchId && (
                    <>
                      {' '}
                      ·{' '}
                      <Link href={`/admin/imports/${c.importBatchId}`}>
                        import {c.importBatchId}
                      </Link>
                    </>
                  )}{' '}
                  · {dateTime.format(c.createdAt)}
                </p>
                {canResolve && (
                  <div className="toolbar">
                    <ActionButton
                      action={resolveConflictAction.bind(null, c.id, 'accept')}
                      label="Use the source’s value"
                      variant="primary"
                    />
                    <ActionForm
                      action={resolveConflictAction.bind(null, c.id, 'reject')}
                      submitLabel="Keep the current value"
                      className="inline-form"
                    >
                      <TextField name="note" label="Why keep it? (optional)" />
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
