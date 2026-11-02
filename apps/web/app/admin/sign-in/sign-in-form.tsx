'use client';

import { useActionState } from 'react';
import { signInAction, type SignInState } from '../actions';

const initialState: SignInState = { error: null, email: '' };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  return (
    <form action={formAction} className="stack" noValidate>
      {state.error && (
        <p role="alert" className="alert">
          {state.error}
        </p>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
        />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
