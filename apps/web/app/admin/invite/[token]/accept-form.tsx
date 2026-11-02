'use client';

import { useActionState } from 'react';
import { acceptInviteAction, type AcceptState } from './actions';

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction.bind(null, token), {
    error: null,
    name: '',
  } as AcceptState);
  return (
    <form action={formAction} className="stack" noValidate>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      <label>
        Your name
        <input name="name" autoComplete="name" required defaultValue={state.name} />
      </label>
      <label>
        Password (at least 12 characters)
        <input name="password" type="password" autoComplete="new-password" required />
      </label>
      <label>
        Password again
        <input name="confirm" type="password" autoComplete="new-password" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
