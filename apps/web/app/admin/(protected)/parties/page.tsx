import type { Metadata } from 'next';
import Link from 'next/link';
import { listParties } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Parties · CivicScope admin' };

export default async function PartiesPage() {
  const user = await requirePermission('admin:view');
  const parties = await listParties(getDb(), { includeArchived: true });
  return (
    <>
      <div className="page-header">
        <h1>Parties</h1>
        {can(user.role, 'content:edit') && (
          <Link href="/admin/parties/new" className="button">
            New party
          </Link>
        )}
      </div>
      {parties.length === 0 ? (
        <p className="muted">No parties yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Short name</th>
              <th scope="col">FEC code</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/parties/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.shortName}</td>
                <td>{p.fecCode}</td>
                <td>{p.deletedAt ? 'Archived' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
