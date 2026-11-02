import Link from 'next/link';
import { listCitations } from '@civicscope/cms';
import { can, sourceTier, type CitationSubject, type UserRole } from '@civicscope/core';
import { addCitationAction, removeCitationAction } from '@/app/admin/(protected)/cms-actions';
import { getDb } from '@/lib/db';
import { formatDate, options, SOURCE_TYPE_LABELS, TIER_LABELS } from '@/lib/labels';
import { ActionButton, ActionForm, SelectField, TextAreaField, TextField } from './form';

/**
 * The fields that identify a source. A URL CivicScope already knows reuses that
 * source; the other fields are only needed the first time a document is cited.
 */
export function SourceFields() {
  return (
    <fieldset className="source-fields">
      <legend>Source</legend>
      <TextField
        name="sourceUrl"
        label="Source URL"
        type="url"
        required
        hint="The exact page or document. If CivicScope already has this URL, the rest can stay blank."
      />
      <TextField name="sourceTitle" label="Source title" />
      <TextField
        name="sourcePublisher"
        label="Publisher"
        hint='Who published it, e.g. "Kentucky State Board of Elections".'
      />
      <SelectField
        name="sourceType"
        label="Source type"
        placeholder="Choose a type…"
        options={options(SOURCE_TYPE_LABELS)}
      />
      <TextField name="sourcePublishedAt" label="Date published (if shown)" type="date" />
    </fieldset>
  );
}

/** A record's sources, with forms to add and remove citations. */
export async function CitationsPanel({
  subjectType,
  subjectId,
  role,
  editable,
  fieldOptions,
}: {
  subjectType: CitationSubject;
  subjectId: number;
  role: UserRole;
  editable: boolean;
  /** Fields a citation can support, as { value: field name, label }. */
  fieldOptions: { value: string; label: string }[];
}) {
  const citations = await listCitations(getDb(), subjectType, subjectId);
  const canEdit = editable && can(role, 'content:edit');
  const fieldLabel = new Map(fieldOptions.map((o) => [o.value, o.label]));

  return (
    <section aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources</h2>
      {citations.length === 0 ? (
        <p className="notice">No sources yet. Every published record needs at least one source.</p>
      ) : (
        <ul className="citations">
          {citations.map((c) => (
            <li key={c.id}>
              <div>
                <a href={c.sourceUrl} rel="noopener noreferrer" target="_blank">
                  {c.sourceTitle}
                </a>{' '}
                <span className="muted">
                  · {c.sourcePublisher} · {TIER_LABELS[sourceTier(c.sourceType)]} · checked{' '}
                  {formatDate(c.retrievedAt)}
                </span>
              </div>
              <div className="muted">
                Supports: {c.field ? (fieldLabel.get(c.field) ?? c.field) : 'the record as a whole'}
                {c.locator ? ` · ${c.locator}` : ''} ·{' '}
                <Link href={`/admin/sources/${c.sourceId}`}>source details</Link>
              </div>
              {c.excerpt && <blockquote>{c.excerpt}</blockquote>}
              {canEdit && (
                <ActionButton
                  action={removeCitationAction.bind(null, c.id)}
                  label="Remove"
                  confirm="Remove this citation? The source itself is kept."
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <details className="add-form">
          <summary>Add a source</summary>
          <ActionForm
            action={addCitationAction.bind(null, subjectType, subjectId)}
            submitLabel="Add source"
            savedMessage="Source added."
            resetOnSave
          >
            <SourceFields />
            <SelectField
              name="field"
              label="What it supports"
              placeholder="The record as a whole"
              options={fieldOptions}
            />
            <TextAreaField
              name="excerpt"
              label="Quote from the source"
              hint="The words that support the fact, copied exactly."
            />
            <TextField name="locator" label="Page or section" />
          </ActionForm>
        </details>
      )}
    </section>
  );
}
