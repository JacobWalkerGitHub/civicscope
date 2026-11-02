import type { Metadata } from 'next';
import Link from 'next/link';
import { listOffices } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { OFFICE_BRANCH_LABELS, OFFICE_LEVEL_LABELS } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Offices · CivicScope admin' };

export default async function OfficesPage() {
  const user = await requirePermission('admin:view');
  const offices = await listOffices(getDb());
  return (
    <>
      <div className="page-header">
        <h1>Offices</h1>
        {can(user.role, 'content:edit') && (
          <Link href="/admin/offices/new" className="button">
            New office
          </Link>
        )}
      </div>
      {offices.length === 0 ? (
        <p className="muted">
          No offices yet. Add the offices on the ballot before creating races.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Jurisdiction</th>
              <th scope="col">Level</th>
              <th scope="col">Branch</th>
            </tr>
          </thead>
          <tbody>
            {offices.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/admin/offices/${o.id}`}>{o.title}</Link>
                </td>
                <td>{o.jurisdictionName}</td>
                <td>{OFFICE_LEVEL_LABELS[o.level]}</td>
                <td>{OFFICE_BRANCH_LABELS[o.branch]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
