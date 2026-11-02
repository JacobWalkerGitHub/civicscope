'use server';

import { redirect } from 'next/navigation';
import { completeSecondFactor, invalidateSession, signIn } from '@civicscope/auth';
import { recordAudit } from '@civicscope/db';
import { getDb } from '@/lib/db';
import {
  clearChallengeCookie,
  setChallengeCookie,
  takeChallengeCookie,
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

  if (result.ok === 'two_step') {
    await setChallengeCookie(result.challenge.token, result.challenge.expiresAt);
    redirect('/admin/sign-in/verify');
  }

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

export interface VerifyState {
  error: string | null;
}

/** Second step of sign-in: an authenticator-app code or a recovery code. */
export async function verifyCodeAction(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const token = await takeChallengeCookie();
  if (!token) redirect('/admin/sign-in?expired=1');
  const code = String(formData.get('code') ?? '');
  if (!code.trim()) return { error: 'Enter the code from your authenticator app.' };

  const result = await completeSecondFactor(getDb(), {
    challengeToken: token,
    code,
    ipAddress: await getClientIp(),
    userAgent: await getUserAgent(),
  });
  if (!result.ok) {
    if (result.reason === 'expired') {
      await clearChallengeCookie();
      redirect('/admin/sign-in?expired=1');
    }
    return { error: 'That code didn’t work. Try the newest code from your app.' };
  }
  await clearChallengeCookie();
  await setSessionCookie(result.session.token, result.session.expiresAt);
  redirect(result.usedRecoveryCode ? '/admin/account?recovery=used' : '/admin');
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
