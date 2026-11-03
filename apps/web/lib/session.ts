import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { clientIpFromForwarded } from '@civicscope/core';
import { redirect } from 'next/navigation';
import { can, type Permission } from '@civicscope/core';
import { twoStepRequired, validateSession, type SessionUser } from '@civicscope/auth';
import { getDb } from './db';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * The __Host- prefix makes the browser reject the cookie unless it is Secure,
 * host-only and path=/, which blocks subdomain cookie injection in production.
 */
export const SESSION_COOKIE = isProduction ? '__Host-cs_session' : 'cs_session';

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The signed-in admin for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Read the cookie first: it marks the page as dynamic and skips the database when absent.
  const token = await getSessionToken();
  if (!token) return null;
  return validateSession(getDb(), token);
});

/**
 * Server-side gate for every admin page and server action. Redirects to sign-in when
 * nobody is signed in, and to the forbidden page when the role lacks the permission.
 */
export async function requirePermission(
  permission: Permission,
  { allowWithoutTwoStep = false } = {},
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/sign-in');
  // Where policy requires two-step sign-in for this role, nothing else is reachable
  // until it is set up (the account page passes allowWithoutTwoStep).
  if (!allowWithoutTwoStep && !user.twoStep && twoStepRequired(user.role)) {
    redirect('/admin/account?setup=required');
  }
  if (!can(user.role, permission)) redirect('/admin/forbidden');
  return user;
}

/** Short-lived cookie holding the sign-in challenge between the password and the code. */
export const CHALLENGE_COOKIE = isProduction ? '__Host-cs_challenge' : 'cs_challenge';

export async function setChallengeCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function takeChallengeCookie(): Promise<string | undefined> {
  return (await cookies()).get(CHALLENGE_COOKIE)?.value;
}

export async function clearChallengeCookie(): Promise<void> {
  (await cookies()).delete(CHALLENGE_COOKIE);
}

function trustedProxyCount(): number {
  const n = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return (
    clientIpFromForwarded(h.get('x-forwarded-for'), trustedProxyCount()) ??
    h.get('x-real-ip')?.slice(0, 45) ??
    null
  );
}

export async function getUserAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}
