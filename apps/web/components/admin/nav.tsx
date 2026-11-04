'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavGroup {
  label: string;
  links: { href: string; label: string; count?: number; exact?: boolean }[];
}

/** The admin sidebar, grouped by task, marking the current section. */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname() ?? '/admin';
  // Races and candidacies live under elections and people.
  const section = path.startsWith('/admin/races')
    ? '/admin/elections'
    : path.startsWith('/admin/candidacies') || path.startsWith('/admin/claims')
      ? '/admin/candidates'
      : path;
  return (
    <nav aria-label="Admin" className="admin-nav">
      {groups.map((g) => (
        <div key={g.label} className="admin-nav-group">
          <p className="admin-nav-label">{g.label}</p>
          {g.links.map((l) => {
            const current = l.exact
              ? section === l.href
              : section === l.href || section.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} aria-current={current ? 'page' : undefined}>
                <span>{l.label}</span>
                {l.count ? (
                  <span className="nav-count" aria-label={`${l.count} waiting`}>
                    {l.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
