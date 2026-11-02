import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCorrectionRequest, NotFoundError } from '@civicscope/cms';
import { can, CORRECTION_STATES } from '@civicscope/core';
import { ActionForm, SelectField, TextAreaField } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { resolveCorrectionAction } from '../actions';
import { CORRECTION_STATE_LABELS } from '../labels';

export const metadata: Metadata = { title: 'Correction request · CivicScope admin' };

export default async function CorrectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('content:edit');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const r = await getCorrectionRequest(getDb(), id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <>
      <p>
        <Link href="/admin/corrections">← Correction requests</Link>
      </p>
      <div className="page-header">
        <h1>Correction request</h1>
        <span className="badge">{CORRECTION_STATE_LABELS[r.state]}</span>
      </div>
      <dl className="facts">
        <dt>Sent</dt>
        <dd>{dateTime.format(r.submittedAt)}</dd>
        <dt>Page</dt>
        <dd>
          {r.pagePath ? (
            <a href={r.pagePath} target="_blank" rel="noopener noreferrer">
              {r.pagePath}
            </a>
          ) : (
            'Not about one page'
          )}
        </dd>
        <dt>What is wrong</dt>
        <dd className="pre-wrap">{r.description}</dd>
        <dt>Their source</dt>
        <dd>
          {r.evidenceUrl ? (
            <a href={r.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow">
              {r.evidenceUrl}
            </a>
          ) : (
            'None given'
          )}
        </dd>
        <dt>Reply to</dt>
        <dd>{r.contactEmail ?? 'No email given'}</dd>
      </dl>
      <p className="hint">
        Readers’ text is shown as typed. Check their source yourself before changing a record; fix
        the record on its own admin page, then mark this request fixed.
      </p>

      {can(user.role, 'content:publish') ? (
        <section aria-labelledby="decide-heading">
          <h2 id="decide-heading">Decision</h2>
          <ActionForm action={resolveCorrectionAction.bind(null, id)} submitLabel="Save decision">
            <SelectField
              name="state"
              label="State"
              options={CORRECTION_STATES.map((s) => ({
                value: s,
                label: CORRECTION_STATE_LABELS[s],
              }))}
              defaultValue={r.state}
              required
            />
            <TextAreaField
              name="internalNote"
              label="Internal note"
              defaultValue={r.internalNote}
              hint="What you checked and decided. Only admins see this."
            />
            <TextAreaField
              name="publicNote"
              label="Public corrections log"
              defaultValue={r.publicNote}
              hint="For a meaningful fix, one neutral sentence on what changed, e.g. “Corrected the filing date for a candidate for governor.” Leave blank to keep it out of the public log."
            />
          </ActionForm>
        </section>
      ) : (
        <p className="muted">A reviewer or owner decides on correction requests.</p>
      )}
      <History entityType="correction_request" entityId={id} role={user.role} />
    </>
  );
}
