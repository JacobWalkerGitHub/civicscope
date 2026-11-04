import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLinks } from './nav-links';

/** A ballot with a check mark: the CivicScope mark. Decorative; the name sits beside it. */
function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="24" height="26" rx="7" />
      <path d="M10.5 16.5l4 4 7.5-9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="icon">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
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
          <form action="/search" role="search" className="header-search">
            <label htmlFor="header-q" className="visually-hidden">
              Search CivicScope
            </label>
            <SearchIcon />
            <input id="header-q" type="search" name="q" placeholder="Search" />
          </form>
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
              Nonpartisan, source-backed research on elections, politicians and the bills they vote
              on. Every fact links to its source, and people are listed in alphabetical order.
            </p>
          </div>
          <nav aria-label="Explore">
            <p className="footer-heading">Explore</p>
            <Link href="/elections">Elections</Link>
            <Link href="/politicians">Politicians</Link>
            <Link href="/bills">Bills</Link>
            <Link href="/issues">Issues</Link>
          </nav>
          <nav aria-label="About CivicScope">
            <p className="footer-heading">About</p>
            <Link href="/about">About</Link>
            <Link href="/methodology">How we work</Link>
            <Link href="/coverage">Coverage</Link>
            <Link href="/corrections">Corrections</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
