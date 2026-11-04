import {
  listPromiseRecordOptions,
  promiseRecordsFor,
  type PromiseRecordView,
} from '@civicscope/cms';
import { ActionButton, ActionForm, SelectField, TextAreaField } from '@/components/admin/form';
import { getDb } from '@/lib/db';
import { addPromiseLinkAction, removePromiseLinkAction } from './promise-actions';

const TYPE_LABEL = { bill: 'Bill', vote: 'Vote', state_vote: 'State vote' } as const;

function optionLabel(r: Omit<PromiseRecordView, 'linkId' | 'claimId' | 'note'>) {
  const title = r.title.length > 90 ? `${r.title.slice(0, 89)}…` : r.title;
  return `${TYPE_LABEL[r.recordType]} · ${r.date ?? 'no date'} · ${r.label}: ${title} (${r.action})`;
}

/**
 * Official bills and votes set beside a campaign promise. Editors pick from the person's
 * own record and describe it neutrally; a change sends the promise back through review.
 */
export async function PromiseRecordPanel({
  claimId,
  personId,
  editable,
  published,
  canReview,
}: {
  claimId: number;
  personId: number;
  editable: boolean;
  published: boolean;
  canReview: boolean;
}) {
  const db = getDb();
  const [links, options] = await Promise.all([
    promiseRecordsFor(db, personId, [claimId]).then((m) => m.get(claimId) ?? []),
    editable ? listPromiseRecordOptions(db, personId) : null,
  ]);
  const linked = new Set(links.map((l) => `${l.recordType}:${l.recordId}`));
  const choices = options
    ? [...options.bills, ...options.votes, ...options.stateVotes]
        .filter((r) => !linked.has(`${r.recordType}:${r.recordId}`))
        .map((r) => ({ value: `${r.recordType}:${r.recordId}`, label: optionLabel(r) }))
    : [];
  return (
    <section aria-labelledby="promise-record-heading">
      <h2 id="promise-record-heading">Record next to this promise</h2>
      <p className="muted">
        Readers see these bills and votes beside the promise. Describe what each record is in
        neutral words. Don’t say whether the promise was kept or broken.
      </p>
      {links.length === 0 ? (
        <p className="muted">No records linked yet.</p>
      ) : (
        <ul className="stack">
          {links.map((l) => (
            <li key={l.linkId}>
              <strong>{TYPE_LABEL[l.recordType]}</strong> · {l.date ?? 'no date'} · {l.label}:{' '}
              {l.title} ({l.action})
              <br />
              <span className="muted">Note:</span> {l.note}{' '}
              {editable && (
                <ActionButton
                  action={removePromiseLinkAction.bind(null, l.linkId)}
                  label="Remove"
                  variant="danger"
                  confirm={
                    published && !canReview
                      ? 'Remove this record? The promise comes off the public site until a reviewer approves the change.'
                      : 'Remove this record from the promise?'
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable &&
        (choices.length === 0 ? (
          <p className="muted">
            No bills or votes are on file for this person. Link their Bioguide or Open States ID on
            their page to see their record here.
          </p>
        ) : (
          <ActionForm
            action={addPromiseLinkAction.bind(null, claimId)}
            submitLabel="Link record"
            savedMessage="Linked."
            resetOnSave
          >
            <SelectField
              name="record"
              label="Bill or vote"
              placeholder="Choose one of their bills or votes"
              options={choices}
              hint="Their most recent sponsored and cosponsored bills and recorded votes."
              required
            />
            <TextAreaField
              name="note"
              label="How it relates"
              hint="For example: “Bill to cap insulin copays at $35 a month.” State facts only."
              required
            />
            {published && !canReview && (
              <p className="hint">
                This promise is published. Linking a record takes it off the public site until a
                reviewer approves the change.
              </p>
            )}
          </ActionForm>
        ))}
    </section>
  );
}
