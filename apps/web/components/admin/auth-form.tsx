'use client';

import { useActionState, type ReactNode } from 'react';
import type { AuthFormState } from '@/lib/auth-action';

type Action = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
const initial: AuthFormState = { error: null };

/** Form for account and user-management actions; shows codes or links returned once. */
export function AuthForm({
  action,
  submitLabel,
  savedMessage,
  children,
  variant,
  className = 'stack form',
}: {
  action: Action;
  submitLabel: string;
  savedMessage?: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className={className} noValidate>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && savedMessage && (
        <p role="status" className="notice">
          {savedMessage}
        </p>
      )}
      {state.codes && <RecoveryCodes codes={state.codes} />}
      {state.link && (
        <div className="notice" role="status">
          <p>
            Send this link to them yourself. It works once and expires in 3 days. It won&apos;t be
            shown again.
          </p>
          <input
            readOnly
            value={state.link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
      {!state.codes && (
        <>
          {children}
          <div>
            <button type="submit" className={variant} disabled={pending}>
              {pending ? 'Working…' : submitLabel}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="notice" role="status">
      <p>
        <strong>Save these recovery codes now.</strong> Each one works once if you lose your phone.
        They won&apos;t be shown again.
      </p>
      <ul className="recovery-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <p>
        <a href="/admin/account">I’ve saved my codes</a>
      </p>
    </div>
  );
}
