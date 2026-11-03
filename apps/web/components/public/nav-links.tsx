'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Upcoming races' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/issues', label: 'Issues' },
  { href: '/elections', label: 'Election calendar' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/methodology', label: 'How we work' },
  { href: '/search', label: 'Search' },
] as const;

/** The main navigation, marking the section the visitor is in. */
export function NavLinks() {
  const path = usePathname() ?? '/';
  const current = (href: string) =>
    href === '/' ? path === '/' || path.startsWith('/races') : path.startsWith(href);
  return (
    <nav aria-label="Main" className="site-nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
