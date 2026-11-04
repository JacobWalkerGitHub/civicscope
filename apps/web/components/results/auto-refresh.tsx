'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Reloads the page's numbers every minute while it is open and visible, without a full
 * page reload, and says when it last did.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Date | null>(null);
  useEffect(() => {
    setChecked(new Date());
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setChecked(new Date());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <p className="auto-refresh" aria-live="off">
      <span className="live-dot" aria-hidden="true" /> Updates every minute
      {checked && (
        <>
          {' '}
          · checked {checked.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </>
      )}
    </p>
  );
}
