'use client';

import { useRouter } from 'next/navigation';
import { useRef, useTransition } from 'react';
import { PARTY_VIEW_COOKIE } from '@/lib/party';

function remember(on: boolean) {
  document.cookie = on
    ? `${PARTY_VIEW_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
    : `${PARTY_VIEW_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * The "Party labels" switch. Off by default. Turning it on first shows a reminder that
 * party labels can bias a reader, and only switches on when the reader confirms.
 */
export function PartyViewToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  const apply = (next: boolean) => {
    remember(next);
    startTransition(() => router.refresh());
  };

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="party-switch"
        disabled={pending}
        onClick={() => (on ? apply(false) : dialog.current?.showModal())}
      >
        <span className="party-switch-track" aria-hidden="true">
          <span className="party-switch-thumb" />
        </span>
        Show party
      </button>
      <dialog
        ref={dialog}
        className="party-dialog"
        aria-labelledby="party-dialog-title"
        aria-describedby="party-dialog-body"
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it, like Cancel.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <form method="dialog">
          <h2 id="party-dialog-title">Before you turn on party labels</h2>
          <div id="party-dialog-body">
            <p>
              Party labels and colors can make you biased. It is easy to like or dislike someone
              because of the letter next to their name.
            </p>
            <p>
              Try to support candidates based on their <strong>policies</strong> and{' '}
              <strong>qualifications</strong>, not their party.
            </p>
          </div>
          <div className="party-dialog-actions">
            <button type="submit" value="cancel" className="button-quiet" autoFocus>
              Keep party hidden
            </button>
            <button
              type="submit"
              value="on"
              onClick={() => {
                dialog.current?.close();
                apply(true);
              }}
            >
              Show party anyway
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
