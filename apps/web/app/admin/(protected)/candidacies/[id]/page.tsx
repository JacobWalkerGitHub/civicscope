import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCandidacy,
  IMPORT_FIELD_LABELS,
  listLocks,
  listParties,
  listStatusEvents,
  NotFoundError,
} from '@civicscope/cms';
import { can, todayIso } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import {
  ActionButton,
  ActionForm,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { CitationsPanel, SourceFields } from '@/components/admin/sources';
import { getDb } from '@/lib/db';
import { CANDIDACY_STATUS_LABELS, dateTime, formatDate, options } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import {
  addStatusEventAction,
  archiveAction,
  publishAction,
  updateCandidacyAction,
} from '../../cms-actions';
import { unlockFieldAction } from '../../imports/actions';
import { CANDIDACY_CITABLE_FIELDS, CandidacyForm } from '../candidacy-form';

export const metadata: Metadata = { title: 'Candidacy · CivicScope admin' };

export default async function CandidacyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const c = await getCandidacy(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [events, parties, locks] = await Promise.all([
    listStatusEvents(db, id),
    listParties(db),
    listLocks(db, 'candidacy', id),
  ]);
  const archived = Boolean(c.deletedAt);
  const published = c.publishState === 'published';
  const canEdit = can(user.role, 'content:edit') && !archived;
  const racePartyName = c.racePartyId
    ? (parties.find((p) => p.id === c.racePartyId)?.name ?? 'party')
    : null;

  return (
    <>
      <p>
        <Link href={`/admin/races/${c.raceId}`}>← {c.raceName}</Link> ·{' '}
        <Link href={`/admin/candidates/${c.personId}`}>{c.personName}</Link>
      </p>
      <div className="page-header">
        <h1>
          {c.ballotName} <span className="muted">for {c.raceName}</span>
        </h1>
        <PublishBadge state={c.publishState} />
      </div>
      <p className="muted">{c.electionName}</p>
      <div className="toolbar">
        {can(user.role, 'content:publish') && !archived && (
          <ActionButton
            action={publishAction.bind(null, 'candidacy', id, !published)}
            label={published ? 'Unpublish' : 'Publish'}
            variant={published ? 'secondary' : 'primary'}
          />
        )}
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'candidacy', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={
              archived
                ? undefined
                : 'Archive this candidacy? It stays in the history and can be restored.'
            }
          />
        )}
      </div>

      {canEdit && (
        <CandidacyForm
          action={updateCandidacyAction.bind(null, id)}
          parties={parties}
          racePartyName={racePartyName}
          candidacy={c}
          submitLabel="Save changes"
        />
      )}

      {locks.length > 0 && (
        <section aria-labelledby="locks-heading">
          <h2 id="locks-heading">Locked fields</h2>
          <p className="muted">
            These were changed by hand, so imports won’t overwrite them. If an import’s source
            disagrees, the difference goes to the review queue. Unlock a field to let imports update
            it again.
          </p>
          <ul>
            {locks.map((l) => (
              <li key={l.id}>
                <strong>{IMPORT_FIELD_LABELS[l.field] ?? l.field}</strong>{' '}
                <span className="muted">
                  · {l.reason}
                  {l.lockedByName && <> by {l.lockedByName}</>}, {dateTime.format(l.createdAt)}
                </span>{' '}
                {can(user.role, 'data:import') && (
                  <ActionButton
                    action={unlockFieldAction.bind(null, l.id)}
                    label={`Unlock ${(IMPORT_FIELD_LABELS[l.field] ?? l.field).toLowerCase()}`}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="status-heading">
        <h2 id="status-heading">Status</h2>
        <p>
          Current:{' '}
          <strong>{c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'No status recorded'}</strong>
          {c.statusDate && <> as of {formatDate(c.statusDate)}</>}
        </p>
        {events.length > 0 && (
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                <strong>{CANDIDACY_STATUS_LABELS[e.status]}</strong>, {formatDate(e.effectiveDate)}{' '}
                ·{' '}
                <a href={e.sourceUrl} rel="noopener noreferrer" target="_blank">
                  {e.sourceTitle}
                </a>
                {e.note && <span className="muted"> · {e.note}</span>}
                <span className="muted"> · recorded by {e.recordedByName ?? 'system'}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="muted">
          Status changes are permanent records. To fix a mistake, record a new status with a note
          explaining the correction.
        </p>
        {canEdit && (
          <details className="add-form">
            <summary>Record a status change</summary>
            <ActionForm
              action={addStatusEventAction.bind(null, id)}
              submitLabel="Record status"
              savedMessage="Status recorded."
              resetOnSave
            >
              <SelectField
                name="status"
                label="Status"
                placeholder="Choose a status…"
                options={options(CANDIDACY_STATUS_LABELS)}
                required
              />
              <TextField
                name="effectiveDate"
                label="Date it took effect"
                type="date"
                defaultValue={todayIso()}
                required
              />
              <SourceFields />
              <TextAreaField name="excerpt" label="Quote from the source" />
              <TextField name="note" label="Note" hint="For example, why a correction was made." />
            </ActionForm>
          </details>
        )}
      </section>

      <CitationsPanel
        subjectType="candidacy"
        subjectId={id}
        role={user.role}
        editable={!archived}
        fieldOptions={CANDIDACY_CITABLE_FIELDS}
      />

      <History entityType="candidacy" entityId={id} role={user.role} />
    </>
  );
}
