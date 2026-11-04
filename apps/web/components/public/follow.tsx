'use client';

import { useActionState, useId } from 'react';
import { followAction } from '@/app/(public)/alerts/actions';
import type { FormState } from '@/lib/admin-action';

const initial: FormState = { error: null, fieldErrors: {}, values: {} };

/**
 * "Get email updates" on a member or bill page: a button that opens a one-field form.
 * Nothing is sent but a confirmation email until the reader confirms.
 */
export function FollowButton({ kind, targetKey }: { kind: 'member' | 'bill'; targetKey: string }) {
  const [state, action, pending] = useActionState(followAction, initial);
  const id = useId();
  const error = state.fieldErrors.email ?? state.error;
  return (
    <details className="follow">
      <summary className="button button-secondary">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
          <path
            d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.5 15.5a2.5 2.5 0 0 0 5 0Z"
            fill="currentColor"
          />
        </svg>
        Get email updates
      </summary>
      <div className="follow-panel">
        {state.saved ? (
          <p role="status">
            <strong>Check your inbox.</strong> We sent a link to confirm. Nothing else is sent until
            you click it.
          </p>
        ) : (
          <form action={action} noValidate>
            <p className="small">
              {kind === 'member'
                ? 'An email when this member casts a recorded vote, sponsors a bill or files a new campaign finance report.'
                : 'An email when this bill takes its next step or gets a recorded vote.'}{' '}
              At most one a day.
            </p>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="key" value={targetKey} />
            <label htmlFor={`${id}-email`}>Your email</label>
            <div className="follow-row">
              <input
                id={`${id}-email`}
                name="email"
                type="email"
                autoComplete="email"
                required
                defaultValue={state.values.email}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              <button type="submit" disabled={pending}>
                {pending ? 'Sending…' : 'Follow'}
              </button>
            </div>
            {error && (
              <p id={`${id}-error`} className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="hp" aria-hidden="true">
              <label htmlFor={`${id}-website`}>Leave this empty</label>
              <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <p className="small muted">
              We use your address only for these emails and never share it. Every email has a
              one-click unsubscribe.
            </p>
          </form>
        )}
      </div>
    </details>
  );
}
