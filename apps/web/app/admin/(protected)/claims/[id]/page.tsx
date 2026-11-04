import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClaim, isPromise, listIssues, NotFoundError } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { PublishBadge, VerificationBadge } from '@/components/admin/badges';
import { ActionButton, ActionForm, TextAreaField } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { CitationsPanel } from '@/components/admin/sources';
import { getDb } from '@/lib/db';
import { CLAIM_KIND_LABELS, CONTENT_KIND_LABELS, dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import {
  approveClaimAction,
  archiveAction,
  claimPublishAction,
  sendClaimBackAction,
  submitClaimAction,
  updateClaimAction,
} from '../../cms-actions';
import { ClaimForm } from '../claim-form';
import { PromiseRecordPanel } from '../promise-record-panel';

export const metadata: Metadata = { title: 'Profile entry · CivicScope admin' };

const CITABLE_FIELDS = [
  { value: 'summary', label: 'Summary' },
  { value: 'quote', label: 'Exact words' },
  { value: 'statedOn', label: 'Date' },
  { value: 'organization', label: 'Organization' },
];

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const c = await getClaim(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const issues = await listIssues(db);
  const archived = Boolean(c.deletedAt);
  const published = c.publishState === 'published';
  const canEdit = can(user.role, 'content:edit') && !archived;
  const canReview = can(user.role, 'content:publish');
  const pending = c.verificationStatus === 'pending_review';
  const ownEdit = c.lastEditedBy === user.id && user.role !== 'owner';

  return (
    <>
      <p>
        <Link href={`/admin/candidates/${c.personId}`}>← {c.personName}</Link>
      </p>
      <div className="page-header">
        <h1>{c.title}</h1>
        <div className="badges">
          <PublishBadge state={c.publishState} />
          <VerificationBadge status={c.verificationStatus} />
        </div>
      </div>
      <p className="muted">
        {CLAIM_KIND_LABELS[c.kind]} · {CONTENT_KIND_LABELS[c.contentKind]}
        {c.lastEditedByName && <> · last edited by {c.lastEditedByName}</>}
        {c.verifiedByName && c.verifiedAt && (
          <>
            {' '}
            · verified by {c.verifiedByName} on {dateTime.format(c.verifiedAt)}
          </>
        )}
      </p>

      {c.reviewNote && c.verificationStatus === 'unverified' && (
        <p className="alert" role="note">
          Sent back by a reviewer: {c.reviewNote}
        </p>
      )}

      {pending && (
        <section className="review-box" aria-labelledby="review-heading">
          <h2 id="review-heading">Waiting for review</h2>
          {!canReview ? (
            <p className="muted">A reviewer will check it against its sources.</p>
          ) : ownEdit ? (
            <p className="muted">
              You made the latest changes, so another reviewer needs to approve them.
            </p>
          ) : (
            <>
              <p className="muted">
                Check the summary and quote against every source below before approving.
              </p>
              <ActionForm
                action={approveClaimAction.bind(null, id)}
                submitLabel="Approve and publish"
                savedMessage="Approved and published."
              >
                <TextAreaField name="note" label="Note for the record (optional)" />
              </ActionForm>
              <ActionForm
                action={sendClaimBackAction.bind(null, id)}
                submitLabel="Send back"
                savedMessage="Sent back to the author."
              >
                <TextAreaField name="note" label="What needs to change" />
              </ActionForm>
            </>
          )}
        </section>
      )}

      <div className="toolbar">
        {canEdit && !published && !pending && c.verificationStatus !== 'verified' && (
          <ActionButton
            action={submitClaimAction.bind(null, id)}
            label="Send for review"
            variant="primary"
          />
        )}
        {canReview && published && (
          <ActionButton action={claimPublishAction.bind(null, id, false)} label="Unpublish" />
        )}
        {canReview && !published && !archived && c.verificationStatus === 'verified' && (
          <ActionButton
            action={claimPublishAction.bind(null, id, true)}
            label="Publish"
            variant="primary"
          />
        )}
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'claim', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={
              archived
                ? undefined
                : 'Archive this entry? It stays in the history and can be restored.'
            }
          />
        )}
      </div>

      {canEdit && (
        <ClaimForm
          action={updateClaimAction.bind(null, id)}
          kind={c.kind}
          issues={issues}
          claim={c}
          submitLabel="Save changes"
          warning={
            published && !canReview
              ? 'This entry is published. Saving changes takes it off the public site until a reviewer approves them.'
              : undefined
          }
        />
      )}

      <CitationsPanel
        subjectType="claim"
        subjectId={id}
        role={user.role}
        editable={!archived}
        fieldOptions={CITABLE_FIELDS}
      />

      {isPromise(c) && (
        <PromiseRecordPanel
          claimId={id}
          personId={c.personId}
          editable={canEdit}
          published={published}
          canReview={canReview}
        />
      )}

      <History entityType="claim" entityId={id} role={user.role} />
    </>
  );
}
