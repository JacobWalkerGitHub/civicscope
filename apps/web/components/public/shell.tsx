import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLinks } from './nav-links';

/** A ballot with a check mark: the CivicScope mark. Decorative; the name sits beside it. */
function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="24" height="26" rx="5" />
      <path d="M10.5 16.5l4 4 7.5-9" />
    </svg>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="brand">
            <Mark />
            <span>CivicScope</span>
          </Link>
          <NavLinks />
        </div>
      </header>
      <main id="content">{children}</main>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <p className="footer-brand">
              <Mark /> CivicScope
            </p>
            <p>
              Nonpartisan, source-backed research on candidates for federal and state office. Every
              fact links to its source, and candidates are listed in alphabetical order.
            </p>
          </div>
          <nav aria-label="About CivicScope">
            <Link href="/about">About</Link>
            <Link href="/methodology">Methodology</Link>
            <Link href="/coverage">Coverage</Link>
            <Link href="/corrections">Corrections</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
