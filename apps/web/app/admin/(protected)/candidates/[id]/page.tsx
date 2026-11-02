import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCurrentPhoto,
  getPerson,
  listCandidaciesForPerson,
  listClaimsForPerson,
  listPersonIdentifiers,
  NotFoundError,
} from '@civicscope/cms';
import { can, CLAIM_KINDS } from '@civicscope/core';
import { PublishBadge, VerificationBadge } from '@/components/admin/badges';
import {
  ActionButton,
  ActionForm,
  FileField,
  SelectField,
  TextField,
} from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { CitationsPanel } from '@/components/admin/sources';
import { getDb } from '@/lib/db';
import {
  CANDIDACY_STATUS_LABELS,
  CLAIM_KIND_LABELS,
  CLAIM_KIND_PLURALS,
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
import { linkPhotoAction, removePhotoAction, uploadPhotoAction } from '../photo-actions';

export const metadata: Metadata = { title: 'Person · CivicScope admin' };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const person = await getPerson(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [identifiers, candidacies, claims, photo] = await Promise.all([
    listPersonIdentifiers(db, id),
    listCandidaciesForPerson(db, id),
    listClaimsForPerson(db, id),
    getCurrentPhoto(db, id),
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
        {!archived && (
          <Link href={`/admin/preview/candidates/${person.slug}`} className="button">
            Preview public page
          </Link>
        )}
        {published && (
          <Link href={`/candidates/${person.slug}`} className="button">
            View public page
          </Link>
        )}
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

      <section aria-labelledby="photo-heading">
        <h2 id="photo-heading">Photo</h2>
        {photo ? (
          <div className="admin-photo">
            <img src={`/photos/${photo.id}`} alt={`Current photo of ${person.fullName}`} />
            <p>
              Credit: {photo.credit} ·{' '}
              <a href={photo.sourceUrl} rel="noopener noreferrer" target="_blank">
                where it came from
              </a>
            </p>
            {canEdit && (
              <ActionButton
                action={removePhotoAction.bind(null, id)}
                label="Remove photo"
                confirm="Stop showing this photo? It stays in the history."
              />
            )}
          </div>
        ) : (
          <p className="muted">No photo yet.</p>
        )}
        {canEdit && (
          <>
            <details className="add-form">
              <summary>{photo ? 'Replace with an uploaded photo' : 'Upload a photo'}</summary>
              <ActionForm
                action={uploadPhotoAction.bind(null, id)}
                submitLabel="Upload photo"
                savedMessage="Photo saved."
                resetOnSave
              >
                <FileField
                  name="file"
                  label="Photo file"
                  accept="image/jpeg,image/png,image/webp"
                  hint="JPEG, PNG or WebP, up to 5 MB. Use an official or campaign photo."
                  required
                />
                <TextField
                  name="sourceUrl"
                  label="Where it came from"
                  type="url"
                  hint="The page you got the photo from, e.g. the campaign's press page."
                  required
                />
                <TextField
                  name="credit"
                  label="Credit"
                  hint='Shown under the photo, e.g. "Smith for Senate campaign".'
                  required
                />
              </ActionForm>
            </details>
            <details className="add-form">
              <summary>
                {photo ? 'Replace with a photo from a link' : 'Add a photo from a link'}
              </summary>
              <ActionForm
                action={linkPhotoAction.bind(null, id)}
                submitLabel="Copy photo from link"
                savedMessage="Photo saved."
                resetOnSave
              >
                <TextField
                  name="imageUrl"
                  label="Image link"
                  type="url"
                  hint="The https:// address of the image itself. CivicScope saves its own copy."
                  required
                />
                <TextField
                  name="sourceUrl"
                  label="Page it appears on"
                  type="url"
                  hint="Optional. Leave blank to use the image link."
                />
                <TextField name="credit" label="Credit" required />
              </ActionForm>
            </details>
          </>
        )}
      </section>

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

      <section aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <p className="muted">
          Positions, biography and accomplishments. Each entry needs a source and a reviewer&apos;s
          approval before it is published.
        </p>
        {CLAIM_KINDS.map((kind) => {
          const entries = claims.filter((c) => c.kind === kind && !c.deletedAt);
          return (
            <div key={kind}>
              <h3>{CLAIM_KIND_PLURALS[kind]}</h3>
              {entries.length === 0 ? (
                <p className="muted">None yet.</p>
              ) : (
                <ul>
                  {entries.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/claims/${c.id}`}>{c.title}</Link>
                      {c.issueName && <span className="muted"> · {c.issueName}</span>}{' '}
                      <PublishBadge state={c.publishState} />{' '}
                      <VerificationBadge status={c.verificationStatus} />
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <p>
                  <Link href={`/admin/candidates/${id}/entries/new?kind=${kind}`}>
                    Add {CLAIM_KIND_LABELS[kind].toLowerCase()}
                  </Link>
                </p>
              )}
            </div>
          );
        })}
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
