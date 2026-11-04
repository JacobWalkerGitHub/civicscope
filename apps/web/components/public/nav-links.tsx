'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/elections', label: 'Elections', also: ['/races'] },
  { href: '/politicians', label: 'Politicians', also: ['/candidates'] },
  { href: '/bills', label: 'Bills', also: [] },
  { href: '/issues', label: 'Issues', also: [] },
  { href: '/ballot', label: 'My ballot', also: [] },
] as const;

/** The main navigation, marking the section the visitor is in. */
export function NavLinks() {
  const path = usePathname() ?? '/';
  const current = (l: (typeof LINKS)[number]) =>
    [l.href, ...l.also].some((h) => path === h || path.startsWith(`${h}/`));
  return (
    <nav aria-label="Main" className="site-nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
