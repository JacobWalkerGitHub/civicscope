import Link from 'next/link';
import type { ReactNode } from 'react';
import { countOpenConflicts, countOpenCorrections, countReviewQueue } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { AdminNav, type NavGroup } from '@/components/admin/nav';
import { MenuDrawer } from '@/components/menu-drawer';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { signOutAction } from '../actions';
import '../admin.css';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePermission('admin:view', { allowWithoutTwoStep: true });
  const [entries, conflicts, corrections] = await Promise.all([
    countReviewQueue(getDb()),
    countOpenConflicts(getDb()),
    countOpenCorrections(getDb()),
  ]);
  const waiting = entries + conflicts;
  const groups: NavGroup[] = [
    {
      label: 'Overview',
      links: [{ href: '/admin', label: 'Dashboard', exact: true }],
    },
    {
      label: 'Build the ballot',
      links: [
        { href: '/admin/elections', label: 'Elections & races' },
        { href: '/admin/candidates', label: 'People & candidates' },
        { href: '/admin/offices', label: 'Offices' },
        { href: '/admin/parties', label: 'Parties' },
        { href: '/admin/issues', label: 'Issues' },
      ],
    },
    {
      label: 'Check & publish',
      links: [
        { href: '/admin/review', label: 'Review queue', count: waiting },
        ...(can(user.role, 'content:edit')
          ? [{ href: '/admin/corrections', label: 'Corrections', count: corrections }]
          : []),
        { href: '/admin/coverage', label: 'Coverage' },
      ],
    },
    {
      label: 'Data',
      links: [
        { href: '/admin/sources', label: 'Sources' },
        { href: '/admin/imports', label: 'CSV imports' },
        { href: '/admin/ingest', label: 'Automated imports' },
      ],
    },
    ...(can(user.role, 'users:manage')
      ? [{ label: 'Settings', links: [{ href: '/admin/users', label: 'Users' }] }]
      : []),
  ];
  return (
    <div className="admin admin-shell">
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">
            ✓
          </span>
          CivicScope <span className="admin-brand-sub">Admin</span>
        </Link>
        <MenuDrawer id="admin-menu" className="admin-menu">
          <AdminNav groups={groups} />
          <div className="admin-who">
            <Link href="/admin/account" className="admin-who-name">
              {user.name}
            </Link>
            <span className="admin-role">{user.role}</span>
            <div className="admin-who-actions">
              <Link href="/" className="admin-quiet-link">
                View site ↗
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="link-button">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </MenuDrawer>
      </aside>
      <main id="admin-main" className="admin-main">
        {children}
      </main>
    </div>
  );
}
