import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPerson,
  listCandidaciesForPerson,
  listPersonIdentifiers,
  NotFoundError,
} from '@civicscope/cms';
import { can } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { ActionButton, ActionForm, SelectField, TextField } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { CitationsPanel } from '@/components/admin/sources';
import { getDb } from '@/lib/db';
import {
  CANDIDACY_STATUS_LABELS,
  formatDate,
  IDENTIFIER_SCHEME_LABELS,
  options,
} from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import {
  addIdentifierAction,
  archiveAction,
  publishAction,
  removeIdentifierAction,
  updatePersonAction,
} from '../../cms-actions';
import { PERSON_CITABLE_FIELDS, PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'Person · CivicScope admin' };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const person = await getPerson(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [identifiers, candidacies] = await Promise.all([
    listPersonIdentifiers(db, id),
    listCandidaciesForPerson(db, id),
  ]);
  const archived = Boolean(person.deletedAt);
  const published = person.publishState === 'published';
  const canEdit = can(user.role, 'content:edit') && !archived;

  return (
    <>
      <p>
        <Link href="/admin/candidates">← Candidates</Link>
      </p>
      <div className="page-header">
        <h1>{person.fullName}</h1>
        <PublishBadge state={person.publishState} />
      </div>
      <div className="toolbar">
        {can(user.role, 'content:publish') && !archived && (
          <ActionButton
            action={publishAction.bind(null, 'person', id, !published)}
            label={published ? 'Unpublish' : 'Publish'}
            variant={published ? 'secondary' : 'primary'}
          />
        )}
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'person', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={
              archived
                ? undefined
                : 'Archive this person? They stay in the history and can be restored.'
            }
          />
        )}
      </div>

      {canEdit ? (
        <PersonForm
          action={updatePersonAction.bind(null, id)}
          person={person}
          submitLabel="Save changes"
        />
      ) : (
        <dl>
          <dt>Preferred name</dt>
          <dd>{person.preferredName ?? '—'}</dd>
          <dt>Sort name</dt>
          <dd>{person.sortName}</dd>
          <dt>Birth year</dt>
          <dd>{person.birthYear ?? '—'}</dd>
        </dl>
      )}

      <CitationsPanel
        subjectType="person"
        subjectId={id}
        role={user.role}
        editable={!archived}
        fieldOptions={PERSON_CITABLE_FIELDS}
      />

      <section aria-labelledby="candidacies-heading">
        <h2 id="candidacies-heading">Candidacies</h2>
        {candidacies.length === 0 ? (
          <p className="muted">
            Not in any race yet. Add them from a race&apos;s page under Elections.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Race</th>
                <th scope="col">Election</th>
                <th scope="col">Party on ballot</th>
                <th scope="col">Status</th>
                <th scope="col">Published</th>
              </tr>
            </thead>
            <tbody>
              {candidacies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/candidacies/${c.id}`}>{c.raceName}</Link>
                  </td>
                  <td>
                    {c.electionName} ({formatDate(c.electionDate)})
                  </td>
                  <td>{c.partyName ?? '—'}</td>
                  <td>{c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'No status yet'}</td>
                  <td>
                    <PublishBadge state={c.publishState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="ids-heading">
        <h2 id="ids-heading">IDs in other systems</h2>
        <p className="muted">
          These match this person to records from the FEC, Congress and other sources, so imports
          don&apos;t create duplicates.
        </p>
        {identifiers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">ID</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {identifiers.map((i) => (
                <tr key={i.id}>
                  <td>{IDENTIFIER_SCHEME_LABELS[i.scheme]}</td>
                  <td>
                    <code>{i.value}</code>
                  </td>
                  <td>
                    {canEdit && (
                      <ActionButton
                        action={removeIdentifierAction.bind(null, i.id)}
                        label="Remove"
                        confirm="Remove this ID?"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <details className="add-form">
            <summary>Add an ID</summary>
            <ActionForm
              action={addIdentifierAction.bind(null, id)}
              submitLabel="Add ID"
              savedMessage="ID added."
              resetOnSave
            >
              <SelectField
                name="scheme"
                label="System"
                placeholder="Choose a system…"
                options={options(IDENTIFIER_SCHEME_LABELS)}
                required
              />
              <TextField name="value" label="ID" required />
            </ActionForm>
          </details>
        )}
      </section>

      <History entityType="person" entityId={id} role={user.role} />
    </>
  );
}
