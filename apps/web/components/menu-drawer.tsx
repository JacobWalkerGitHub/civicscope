'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * A "Menu" button that shows and hides its panel on small screens. On wide screens the
 * CSS keeps the panel always visible and hides the button. Navigating closes it.
 */
export function MenuDrawer({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const path = usePathname() ?? '';
  // Open for the page it was opened on, so following a link closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenOn(open ? null : path)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
        <span>Menu</span>
      </button>
      <div id={id} className={className} data-open={open ? '' : undefined}>
        {children}
      </div>
    </>
  );
}
