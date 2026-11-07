'use client';

import { useState, type ReactNode } from 'react';

/**
 * On phones, the filter form folds behind a "Filters" button so the list starts near
 * the top of the screen. On wider screens the CSS always shows the form and hides the
 * button. Starts open when filters are already applied, so they stay visible.
 */
export function FilterPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="filter-panel" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="filter-panel-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {open ? 'Hide filters' : 'Filters'}
        {active > 0 && <span className="filter-panel-count">{active} on</span>}
      </button>
      <div id={id} className="filter-panel-body">
        {children}
      </div>
    </div>
  );
}
