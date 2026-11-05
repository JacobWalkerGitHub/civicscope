import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  IMPORT_FIELD_LABELS,
  NotFoundError,
  previewImport,
  type ImportSummary,
  type PlannedChange,
  type RowAction,
} from '@civicscope/cms';
import { can, type SourceRefInput } from '@civicscope/core';
import { ActionButton } from '@/components/admin/form';
import { getDb } from '@/lib/db';
import { formatImportValue } from '@/lib/imports';
import { dateTime, formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { applyImportAction, discardImportAction } from '../actions';
import { ExternalLink } from '@/components/external-link';

export const metadata: Metadata = { title: 'Import preview · CivicScope admin' };

const ACTION_LABELS: Record<RowAction, string> = {
  create: 'New person and candidacy',
  add_to_race: 'Existing person added to race',
  update: 'Update',
  unchanged: 'No change',
  error: 'Error',
};

function ChangeLine({ c, partyNames }: { c: PlannedChange; partyNames: Map<number, string> }) {
  const label = IMPORT_FIELD_LABELS[c.field] ?? c.field;
  const to = formatImportValue(c.field, c.to, partyNames);
  const date = c.statusDate ? ` as of ${formatDate(c.statusDate)}` : '';
  return (
    <li>
      {label}:{' '}
      {c.from === null ? (
        <>
          {to}
          {date}
        </>
      ) : (
        <>
          {formatImportValue(c.field, c.from, partyNames)} → {to}
          {date}
        </>
      )}
      {c.locked && (
        <strong className="locked">
          {' '}
          · locked (changed by hand), so this goes to the review queue instead
        </strong>
      )}
    </li>
  );
}

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const data = await previewImport(getDb(), id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { batch, plan, partyNames } = data;
  const ref = batch.sourceRef as SourceRefInput;
  const canImport = can(user.role, 'data:import');
  const blocked = plan ? plan.fileErrors.length > 0 || plan.counts.error > 0 : true;
  const summary = batch.summary as ImportSummary | null;

  return (
    <>
      <p>
        <Link href="/admin/imports">← Imports</Link>
      </p>
      <h1>{batch.fileName}</h1>
      <dl className="facts">
        <dt>Race</dt>
        <dd>
          <Link href={`/admin/races/${batch.raceId}`}>{data.raceName}</Link>{' '}
          <span className="muted">· {data.electionName}</span>
        </dd>
        <dt>Source</dt>
        <dd>
          <ExternalLink href={ref.sourceUrl} label={ref.sourceTitle} />
        </dd>
        <dt>Uploaded</dt>
        <dd>
          {dateTime.format(batch.createdAt)}
          {data.createdByName && <> by {data.createdByName}</>}
        </dd>
      </dl>

      {batch.state === 'applied' && summary && (
        <p role="status" className="notice">
          Applied{batch.closedAt && <> on {dateTime.format(batch.closedAt)}</>}: {summary.create}{' '}
          new, {summary.add_to_race} added to the race, {summary.update} updated,{' '}
          {summary.unchanged} unchanged.
          {summary.conflicts > 0 && (
            <>
              {' '}
              {summary.conflicts} locked field{summary.conflicts > 1 ? 's' : ''} went to the{' '}
              <Link href="/admin/review">review queue</Link>.
            </>
          )}
        </p>
      )}
      {batch.state === 'discarded' && <p className="notice">This import was discarded.</p>}

      {plan && (
        <>
          {plan.fileErrors.map((e) => (
            <p key={e} role="alert" className="alert">
              {e}
            </p>
          ))}
          <p>
            <strong>Preview:</strong> {plan.counts.create} new, {plan.counts.add_to_race} added to
            the race, {plan.counts.update} updated, {plan.counts.unchanged} unchanged,{' '}
            {plan.counts.error} with errors
            {plan.conflicts > 0 && <>, {plan.conflicts} locked fields for review</>}. Nothing has
            been written yet.
          </p>
          {canImport && (
            <div className="toolbar">
              {blocked ? (
                <p className="alert" role="alert">
                  Fix the rows with errors in your file (or remove them), then upload it again.
                </p>
              ) : (
                <ActionButton
                  action={applyImportAction.bind(null, id)}
                  label="Apply import"
                  variant="primary"
                  confirm="Apply every row of this file now?"
                />
              )}
              <ActionButton action={discardImportAction.bind(null, id)} label="Discard" />
            </div>
          )}
          <table className="import-preview">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Name</th>
                <th scope="col">What happens</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.line} className={r.action === 'error' ? 'row-error' : undefined}>
                  <td>{r.line}</td>
                  <td>
                    {r.name}
                    {r.personId && (
                      <>
                        {' '}
                        <Link href={`/admin/candidates/${r.personId}`} className="muted">
                          (person {r.personId})
                        </Link>
                      </>
                    )}
                  </td>
                  <td>{ACTION_LABELS[r.action]}</td>
                  <td>
                    {r.errors.length > 0 && (
                      <ul className="field-error">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                    {r.errors.length === 0 && (r.changes.length > 0 || r.addFecId) && (
                      <ul>
                        {r.changes.map((c) => (
                          <ChangeLine key={c.field} c={c} partyNames={partyNames} />
                        ))}
                        {r.addFecId && <li>FEC candidate ID: {r.addFecId}</li>}
                      </ul>
                    )}
                    {r.warnings.map((w) => (
                      <p key={w} className="muted">
                        {w}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
