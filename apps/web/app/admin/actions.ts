'use server';

import { redirect } from 'next/navigation';
import { invalidateSession, signIn } from '@civicscope/auth';
import { recordAudit } from '@civicscope/db';
import { getDb } from '@/lib/db';
import {
  clearSessionCookie,
  getClientIp,
  getCurrentUser,
  getSessionToken,
  getUserAgent,
  setSessionCookie,
} from '@/lib/session';

export interface SignInState {
  error: string | null;
  email: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', email };

  const result = await signIn(getDb(), {
    email,
    password,
    ipAddress: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  if (!result.ok) {
    return {
      email,
      error:
        result.reason === 'locked'
          ? 'Too many failed attempts. Try again in 15 minutes.'
          : 'Email or password is incorrect.',
    };
  }

  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect('/admin');
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (token) await invalidateSession(getDb(), token);
  if (user) {
    await recordAudit(getDb(), {
      actorType: 'user',
      actorId: String(user.id),
      action: 'sign_out',
      entityType: 'admin_user',
      entityId: user.id,
      ipAddress: await getClientIp(),
    });
  }
  await clearSessionCookie();
  redirect('/admin/sign-in');
}
