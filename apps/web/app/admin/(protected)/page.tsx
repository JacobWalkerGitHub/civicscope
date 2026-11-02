import type { Metadata } from 'next';
import Link from 'next/link';
import { ROLE_DESCRIPTIONS } from '@civicscope/core';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard · CivicScope admin' };

export default async function DashboardPage() {
  const user = await requirePermission('admin:view');
  return (
    <>
      <h1>Dashboard</h1>
      <p>
        Signed in as <strong>{user.email}</strong> ({user.role}): {ROLE_DESCRIPTIONS[user.role]}
      </p>
      <ul>
        <li>
          <Link href="/admin/candidates">Candidates</Link>
        </li>
        <li>
          <Link href="/admin/elections">Elections and races</Link>
        </li>
        <li>
          <Link href="/admin/offices">Offices</Link>
        </li>
        <li>
          <Link href="/admin/parties">Parties</Link>
        </li>
        <li>
          <Link href="/admin/sources">Sources</Link>
        </li>
      </ul>
    </>
  );
}
