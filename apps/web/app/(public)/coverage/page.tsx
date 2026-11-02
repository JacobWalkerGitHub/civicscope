import type { Metadata } from 'next';
import { listCoverage } from '@civicscope/cms';
import type { CoverageLevel } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { formatDate, OFFICE_LEVEL_LABELS } from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Coverage · CivicScope',
  description: 'Which states, elections and offices CivicScope covers, and how completely.',
};

// Reads the database on every request, so a change in the admin shows up at once.
export const dynamic = 'force-dynamic';

const LEVEL_LABELS: Record<CoverageLevel, string> = {
  none: 'Not covered',
  partial: 'Partial',
  complete: 'Complete',
};

export default async function CoveragePage() {
  const rows = await listCoverage(getDb());
  const cycles = [...new Set(rows.map((r) => r.cycleYear))];
  return (
    <>
      <h1>Coverage</h1>
      <p>
        CivicScope covers a small number of elections well rather than many elections badly. This
        page lists exactly what we cover. <strong>Anything not listed here is not covered</strong>,
        so a missing candidate or race is not a sign that it doesn’t exist.
      </p>
      <dl className="definitions">
        <div>
          <dt>Complete</dt>
          <dd>Every candidate on the ballot, as of the date shown.</dd>
        </div>
        <div>
          <dt>Partial</dt>
          <dd>Some races or candidates only. The note says which.</dd>
        </div>
        <div>
          <dt>Not covered</dt>
          <dd>We have looked at it but have not added it yet.</dd>
        </div>
      </dl>
      {rows.length === 0 ? (
        <p className="notice">No coverage is published yet.</p>
      ) : (
        cycles.map((year) => (
          <section key={year} aria-labelledby={`cycle-${year}`}>
            <h2 id={`cycle-${year}`}>{year} elections</h2>
            <table>
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Offices</th>
                  <th scope="col">Coverage</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.cycleYear === year)
                  .map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.jurisdictionName}</th>
                      <td>{OFFICE_LEVEL_LABELS[r.officeLevel]}</td>
                      <td>
                        {LEVEL_LABELS[r.level]}
                        {r.asOf && <> as of {formatDate(r.asOf)}</>}
                      </td>
                      <td>{r.note}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}
