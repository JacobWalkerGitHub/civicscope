import type { Metadata } from 'next';
import { listCoverage, listStates } from '@civicscope/cms';
import { can, COVERAGE_LEVELS, type CoverageLevel } from '@civicscope/core';
import { ActionButton, ActionForm, SelectField, TextField } from '@/components/admin/form';
import { getDb } from '@/lib/db';
import { formatDate, OFFICE_LEVEL_LABELS, options } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { removeCoverageAction, setCoverageAction } from '../corrections/actions';

export const metadata: Metadata = { title: 'Coverage · CivicScope admin' };

const LEVEL_LABELS: Record<CoverageLevel, string> = {
  none: 'Not covered',
  partial: 'Partial',
  complete: 'Complete',
};

export default async function CoverageAdminPage() {
  const user = await requirePermission('admin:view');
  const db = getDb();
  const [rows, states] = await Promise.all([listCoverage(db), listStates(db)]);
  const canEdit = can(user.role, 'content:publish');
  return (
    <>
      <div className="page-header">
        <h1>Coverage</h1>
      </div>
      <p>
        This table is the public <a href="/coverage">Coverage page</a>. Anything not listed is shown
        as not covered. Changes are public as soon as you save.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Nothing listed yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Cycle</th>
              <th scope="col">State</th>
              <th scope="col">Offices</th>
              <th scope="col">Coverage</th>
              <th scope="col">Note</th>
              {canEdit && <th scope="col">Remove</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.cycleYear}</td>
                <td>{r.jurisdictionName}</td>
                <td>{OFFICE_LEVEL_LABELS[r.officeLevel]}</td>
                <td>
                  {LEVEL_LABELS[r.level]}
                  {r.asOf && <> as of {formatDate(r.asOf)}</>}
                </td>
                <td>{r.note}</td>
                {canEdit && (
                  <td>
                    <ActionButton
                      action={removeCoverageAction.bind(null, r.id)}
                      label="Remove"
                      variant="danger"
                      confirm="Remove this row from the public Coverage page?"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <section aria-labelledby="set-coverage">
          <h2 id="set-coverage">Add or update a row</h2>
          <p className="hint">
            Saving a state, cycle and office level that is already listed replaces it.
          </p>
          <ActionForm action={setCoverageAction} submitLabel="Save coverage" resetOnSave>
            <SelectField
              name="jurisdictionId"
              label="State"
              placeholder="Choose a state"
              options={states.map((s) => ({ value: s.id, label: s.name }))}
              required
            />
            <TextField name="cycleYear" label="Election year" type="number" required />
            <SelectField
              name="officeLevel"
              label="Offices"
              options={options(OFFICE_LEVEL_LABELS)}
              required
            />
            <SelectField
              name="level"
              label="Coverage"
              options={COVERAGE_LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))}
              required
            />
            <TextField
              name="asOf"
              label="Complete as of"
              type="date"
              hint="Required for complete coverage: the date you last checked the official candidate list."
            />
            <TextField
              name="note"
              label="Note"
              hint="Shown publicly, e.g. “Governor race only” or “Primary candidates added after the filing deadline.”"
            />
          </ActionForm>
        </section>
      )}
    </>
  );
}
