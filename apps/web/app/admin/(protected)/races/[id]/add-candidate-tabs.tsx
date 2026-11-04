'use client';

import { useState, type ReactNode } from 'react';

/** Two ways to add a candidate: someone already in CivicScope, or someone new. */
export function AddCandidateTabs({ existing, fresh }: { existing: ReactNode; fresh: ReactNode }) {
  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  return (
    <div className="segmented-wrap">
      <div className="segmented" role="tablist" aria-label="Who are you adding?">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'existing'}
          onClick={() => setTab('existing')}
        >
          Someone already in CivicScope
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'new'}
          onClick={() => setTab('new')}
        >
          Someone new
        </button>
      </div>
      <div role="tabpanel">{tab === 'existing' ? existing : fresh}</div>
    </div>
  );
}
