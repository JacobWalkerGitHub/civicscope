import type { ElectionDeadline, OfficialResource } from '@civicscope/cms';
import { can, shortUrl, type UserRole as Role } from '@civicscope/core';
import { ActionButton, ActionForm, SelectField, TextField } from '@/components/admin/form';
import {
  dateTime,
  DEADLINE_KIND_LABELS,
  formatDate,
  options,
  RESOURCE_KIND_LABELS,
} from '@/lib/labels';
import {
  archiveResourceAction,
  checkResourceAction,
  createDeadlineAction,
  createResourceAction,
  removeDeadlineAction,
  updateDeadlineAction,
  updateResourceAction,
} from '../cms-actions';
import { ExternalLink } from '@/components/external-link';

function DeadlineFields({ d }: { d?: ElectionDeadline }) {
  return (
    <>
      <SelectField
        name="kind"
        label="Kind of date"
        options={options(DEADLINE_KIND_LABELS)}
        defaultValue={d?.kind}
        placeholder="Choose…"
        required
      />
      <TextField name="date" label="Date" type="date" defaultValue={d?.date} required />
      <TextField
        name="label"
        label="Description"
        defaultValue={d?.label}
        hint='As the official calendar puts it, e.g. "Last day for candidates to file, 4:00 p.m."'
        required
      />
      <TextField
        name="sourceUrl"
        label="Official source"
        type="url"
        defaultValue={d?.sourceUrl}
        hint="The election authority's calendar or the statute that sets this date (https://). Never copy a date from a previous year."
        required
      />
    </>
  );
}

/** Key dates for one election, on its admin page. */
export function DeadlinesSection({
  electionId,
  deadlines,
  role,
  published,
  archived,
}: {
  electionId: number;
  deadlines: ElectionDeadline[];
  role: Role;
  published: boolean;
  archived: boolean;
}) {
  // Dates have no draft state: on a published election they show at once.
  const canChange = !archived && can(role, published ? 'content:publish' : 'content:edit');
  const canRemove = !archived && can(role, published ? 'content:publish' : 'content:archive');
  return (
    <section aria-labelledby="deadlines-heading">
      <h2 id="deadlines-heading">Key dates</h2>
      <p className="hint">
        Filing, registration and voting dates, each linked to the official document that sets it.
        They appear on the public calendar with the election
        {published ? ', so changes here show at once.' : ' once it is published.'}
      </p>
      {deadlines.length === 0 ? (
        <p className="muted">No dates yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Kind</th>
              <th scope="col">Description</th>
              <th scope="col">Source</th>
              {(canChange || canRemove) && <th scope="col">Change</th>}
            </tr>
          </thead>
          <tbody>
            {deadlines.map((d) => (
              <tr key={d.id}>
                <td>{formatDate(d.date)}</td>
                <td>{DEADLINE_KIND_LABELS[d.kind]}</td>
                <td>{d.label}</td>
                <td>
                  <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {new URL(d.sourceUrl).hostname}
                  </a>
                </td>
                {(canChange || canRemove) && (
                  <td>
                    {canChange && (
                      <details>
                        <summary>Edit</summary>
                        <ActionForm
                          action={updateDeadlineAction.bind(null, d.id)}
                          submitLabel="Save date"
                        >
                          <DeadlineFields d={d} />
                        </ActionForm>
                      </details>
                    )}
                    {canRemove && (
                      <ActionButton
                        action={removeDeadlineAction.bind(null, d.id)}
                        label="Remove"
                        variant="danger"
                        confirm="Remove this date? The history keeps a record of it."
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canChange && (
        <details>
          <summary>Add a date</summary>
          <ActionForm
            action={createDeadlineAction.bind(null, electionId)}
            submitLabel="Add date"
            savedMessage="Date added."
            resetOnSave
          >
            <DeadlineFields />
          </ActionForm>
        </details>
      )}
    </section>
  );
}

function ResourceFields({ r }: { r?: OfficialResource }) {
  return (
    <>
      <SelectField
        name="kind"
        label="Kind of link"
        options={options(RESOURCE_KIND_LABELS)}
        defaultValue={r?.kind}
        placeholder="Choose…"
        required
      />
      <TextField
        name="label"
        label="Label"
        defaultValue={r?.label}
        hint='e.g. "Kentucky State Board of Elections"'
        required
      />
      <TextField
        name="url"
        label="Address"
        type="url"
        defaultValue={r?.url}
        hint="Official government pages only (https://)."
        required
      />
    </>
  );
}

/** A state's official election links, shown on every public election page for the state. */
export function ResourcesSection({
  jurisdictionId,
  jurisdictionName,
  resources,
  role,
}: {
  jurisdictionId: number;
  jurisdictionName: string;
  resources: OfficialResource[];
  role: Role;
}) {
  const canChange = can(role, 'content:publish');
  const live = resources.filter((r) => !r.deletedAt);
  const archived = resources.filter((r) => r.deletedAt);
  return (
    <section aria-labelledby="resources-heading">
      <h2 id="resources-heading">Official links for {jurisdictionName}</h2>
      <p className="hint">
        Shown on every published {jurisdictionName} election, so adding or changing one needs
        permission to publish.
      </p>
      {live.length === 0 ? (
        <p className="muted">No links yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Link</th>
              <th scope="col">Last checked</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.id}>
                <td>{RESOURCE_KIND_LABELS[r.kind]}</td>
                <td>
                  <ExternalLink href={r.url} label={r.label} />
                </td>
                <td>{r.lastCheckedAt ? dateTime.format(r.lastCheckedAt) : 'Never'}</td>
                <td>
                  {can(role, 'content:edit') && (
                    <ActionButton
                      action={checkResourceAction.bind(null, r.id)}
                      label="I checked it works"
                    />
                  )}
                  {canChange && (
                    <>
                      <details>
                        <summary>Edit</summary>
                        <ActionForm
                          action={updateResourceAction.bind(null, r.id)}
                          submitLabel="Save link"
                        >
                          <ResourceFields r={r} />
                        </ActionForm>
                      </details>
                      <ActionButton
                        action={archiveResourceAction.bind(null, r.id, true)}
                        label="Archive"
                        variant="danger"
                        confirm="Archive this link? It stops showing on the public site."
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {archived.length > 0 && (
        <details>
          <summary>Archived links ({archived.length})</summary>
          <ul>
            {archived.map((r) => (
              <li key={r.id}>
                {r.label} <span className="muted">({shortUrl(r.url)})</span>{' '}
                {canChange && (
                  <ActionButton
                    action={archiveResourceAction.bind(null, r.id, false)}
                    label="Restore"
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canChange && (
        <details>
          <summary>Add a link</summary>
          <ActionForm
            action={createResourceAction.bind(null, jurisdictionId)}
            submitLabel="Add link"
            savedMessage="Link added."
            resetOnSave
          >
            <ResourceFields />
          </ActionForm>
        </details>
      )}
    </section>
  );
}
