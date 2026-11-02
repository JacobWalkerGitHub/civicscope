import Link from 'next/link';
import type { ReactNode } from 'react';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/" className="brand">
          CivicScope
        </Link>
        <p className="tagline">Nonpartisan, source-backed candidate research</p>
      </header>
      <main id="content">{children}</main>
      <footer className="site-footer">
        <p>
          CivicScope is nonpartisan. Every fact links to its source, and candidates are listed in
          alphabetical order.
        </p>
      </footer>
    </>
  );
}
