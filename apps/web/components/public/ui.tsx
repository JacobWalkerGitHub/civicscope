import Link from 'next/link';
import type { ReactNode } from 'react';
import type { BillStage } from '@civicscope/core';
import { BILL_STAGE_LABELS, BILL_STAGE_TONES } from '@/lib/labels';

/** The heading block at the top of a section page. */
export function PageIntro({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-intro">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <div className="page-intro-lede">{children}</div>}
      </div>
      {actions && <div className="page-intro-actions">{actions}</div>}
    </header>
  );
}

/** Tabs that are links, so each view has its own address. */
export function Tabs({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; count?: number; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="tab-bar">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.current ? 'page' : undefined}>
          {t.label}
          {t.count != null && <span className="tab-count">{t.count.toLocaleString('en-US')}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Pager({
  page,
  pages,
  href,
}: {
  page: number;
  pages: number;
  href: (n: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : <span />}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('');

/** A round monogram for people without a photo. One color for everyone. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function StageBadge({ stage }: { stage: BillStage | null }) {
  if (!stage) return <span className="status-badge tone-none">Status unknown</span>;
  return (
    <span className={`status-badge tone-${BILL_STAGE_TONES[stage]}`}>
      {BILL_STAGE_TONES[stage] === 'won' && <span aria-hidden="true">✓ </span>}
      {BILL_STAGE_LABELS[stage]}
    </span>
  );
}

/** Where a page's data comes from, in one line under its heading. */
export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="source-note">{children}</p>;
}
