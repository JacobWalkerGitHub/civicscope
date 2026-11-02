import Link from 'next/link';
import type { ReactNode } from 'react';
import { countReviewQueue } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { signOutAction } from '../actions';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePermission('admin:view', { allowWithoutTwoStep: true });
  const waiting = await countReviewQueue(getDb());
  return (
    <div className="admin">
      <header className="admin-header">
        <nav aria-label="Admin">
          <Link href="/admin" className="brand">
            CivicScope admin
          </Link>
          <Link href="/admin/candidates">Candidates</Link>
          <Link href="/admin/elections">Elections</Link>
          <Link href="/admin/offices">Offices</Link>
          <Link href="/admin/parties">Parties</Link>
          <Link href="/admin/sources">Sources</Link>
          <Link href="/admin/issues">Issues</Link>
          <Link href="/admin/review">
            Review
            {waiting > 0 && (
              <span className="nav-count" aria-label={`${waiting} waiting`}>
                {waiting}
              </span>
            )}
          </Link>
          {can(user.role, 'users:manage') && <Link href="/admin/users">Users</Link>}
        </nav>
        <div className="who">
          <span>
            <Link href="/admin/account">{user.name}</Link> ·{' '}
            <span className="role">{user.role}</span>
          </span>
          <form action={signOutAction}>
            <button type="submit" className="link-button">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
