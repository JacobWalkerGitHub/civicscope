import Link from 'next/link';
import type { ReactNode } from 'react';
import { can } from '@civicscope/core';
import { requirePermission } from '@/lib/session';
import { signOutAction } from '../actions';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePermission('admin:view');
  return (
    <div className="admin">
      <header className="admin-header">
        <nav aria-label="Admin">
          <Link href="/admin" className="brand">
            CivicScope admin
          </Link>
          {can(user.role, 'users:manage') && <Link href="/admin/users">Users</Link>}
        </nav>
        <div className="who">
          <span>
            {user.name} · <span className="role">{user.role}</span>
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
