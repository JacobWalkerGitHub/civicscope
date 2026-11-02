'use client';

import { useActionState } from 'react';
import { verifyCodeAction, type VerifyState } from '../../actions';

const initialState: VerifyState = { error: null };

export function VerifyForm() {
  const [state, formAction, pending] = useActionState(verifyCodeAction, initialState);
  return (
    <form action={formAction} className="stack" noValidate>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      <label>
        Code
        <input
          name="code"
          autoComplete="one-time-code"
          inputMode="text"
          autoFocus
          required
          maxLength={20}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Verify'}
      </button>
    </form>
  );
}
