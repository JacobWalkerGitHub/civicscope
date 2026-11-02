import type { Metadata } from 'next';
import Link from 'next/link';
import { listImports, listRacesForImport, type ImportSummary } from '@civicscope/cms';
import { can, CANDIDATE_IMPORT_COLUMNS } from '@civicscope/core';
import { ActionForm, FileField, SelectField } from '@/components/admin/form';
import { SourceFields } from '@/components/admin/sources';
import { getDb } from '@/lib/db';
import { dateTime, formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { uploadImportAction } from './actions';

export const metadata: Metadata = { title: 'Imports · CivicScope admin' };

const STATE_LABELS = { preview: 'Waiting to apply', applied: 'Applied', discarded: 'Discarded' };

function summaryText(s: ImportSummary | null) {
  if (!s) return '—';
  return `${s.create} new, ${s.add_to_race} added, ${s.update} updated, ${s.unchanged} unchanged${s.conflicts ? `, ${s.conflicts} conflicts` : ''}`;
}

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ race?: string }>;
}) {
  const user = await requirePermission('admin:view');
  const db = getDb();
  const [imports, races] = await Promise.all([listImports(db), listRacesForImport(db)]);
  const { race } = await searchParams;
  const canImport = can(user.role, 'data:import');

  return (
    <>
      <h1>Imports</h1>
      <p className="muted">
        Load a race’s candidates from a CSV file, such as an election office’s candidate list.
        Nothing is written until you check the preview and apply it. Every imported row is cited to
        the file’s source, new records start as drafts, and fields someone changed by hand are never
        overwritten: a difference goes to the review queue instead.
      </p>

      {canImport && (
        <section aria-labelledby="upload-heading">
          <h2 id="upload-heading">Upload a candidate list</h2>
          <details className="hint-box">
            <summary>File format</summary>
            <p>
              One row per candidate, with a header row. Only <code>full_name</code> is required;
              blank cells leave existing values alone. Columns:{' '}
              {Object.keys(CANDIDATE_IMPORT_COLUMNS).map((c, i) => (
                <span key={c}>
                  {i > 0 && ', '}
                  <code>{c}</code>
                </span>
              ))}
              .
            </p>
            <ul>
              <li>
                <code>party</code>: the party’s name, short name or FEC code, as on the Parties
                page.
              </li>
              <li>
                <code>status</code> and <code>status_date</code> go together (for example{' '}
                <code>filed</code> and <code>2027-01-26</code>).
              </li>
              <li>
                <code>incumbent</code>: yes or no.
              </li>
              <li>
                <code>person_id</code>: a person’s number in CivicScope to link that person, or{' '}
                <code>new</code> when someone shares a name with an existing person but is a
                different person.
              </li>
            </ul>
          </details>
          <ActionForm action={uploadImportAction} submitLabel="Upload and preview">
            <SelectField
              name="raceId"
              label="Race"
              placeholder="Choose a race…"
              defaultValue={race}
              required
              options={races.map((r) => ({
                value: r.id,
                label: `${r.name} · ${r.electionName} (${formatDate(r.electionDate)})`,
              }))}
            />
            <FileField name="file" label="CSV file" accept=".csv,text/csv" required />
            <SourceFields />
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Recent imports</h2>
        {imports.length === 0 ? (
          <p className="notice">No imports yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Race</th>
                <th scope="col">State</th>
                <th scope="col">Result</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/admin/imports/${i.id}`}>{i.fileName}</Link>
                  </td>
                  <td>
                    <Link href={`/admin/races/${i.raceId}`}>{i.raceName}</Link>
                  </td>
                  <td>{STATE_LABELS[i.state]}</td>
                  <td>{summaryText(i.summary as ImportSummary | null)}</td>
                  <td>
                    {dateTime.format(i.createdAt)}
                    {i.createdByName && <span className="muted"> by {i.createdByName}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
