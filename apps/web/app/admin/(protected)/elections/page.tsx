import type { Metadata } from 'next';
import Link from 'next/link';
import { listCycleYears, listElections, listStates } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { getDb } from '@/lib/db';
import { ELECTION_TYPE_LABELS, formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Elections · CivicScope admin' };

export default async function ElectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; year?: string; archived?: string }>;
}) {
  const user = await requirePermission('admin:view');
  const params = await searchParams;
  const db = getDb();
  const [states, years] = await Promise.all([listStates(db), listCycleYears(db)]);
  const elections = await listElections(db, {
    jurisdictionId: params.state ? Number(params.state) : undefined,
    year: params.year ? Number(params.year) : undefined,
    includeArchived: params.archived === '1',
  });

  return (
    <>
      <div className="page-header">
        <h1>Elections</h1>
        {can(user.role, 'content:edit') && (
          <Link href="/admin/elections/new" className="button">
            New election
          </Link>
        )}
      </div>
      <form className="filters" method="get">
        <label>
          State
          <select name="state" defaultValue={params.state ?? ''}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select name="year" defaultValue={params.year ?? ''}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={params.archived === '1'}
          />{' '}
          Show archived
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>
      {elections.length === 0 ? (
        <p className="muted">No elections match.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Election</th>
              <th scope="col">State</th>
              <th scope="col">Type</th>
              <th scope="col">Races</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {elections.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>
                  <Link href={`/admin/elections/${e.id}`}>{e.name}</Link>
                </td>
                <td>{e.jurisdictionName}</td>
                <td>{ELECTION_TYPE_LABELS[e.type]}</td>
                <td>{Number(e.raceCount)}</td>
                <td>
                  <PublishBadge state={e.publishState} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
