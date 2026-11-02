import type { Metadata } from 'next';
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
      <p className="muted">
        Candidate, race and source management arrives in the next parts of Phase 1.
      </p>
    </>
  );
}
