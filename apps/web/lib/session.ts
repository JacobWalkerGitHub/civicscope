import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, type Permission } from '@civicscope/core';
import { validateSession, type SessionUser } from '@civicscope/auth';
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
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/sign-in');
  if (!can(user.role, permission)) redirect('/admin/forbidden');
  return user;
}

/** Client IP as reported by the load balancer (first X-Forwarded-For entry). */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || h.get('x-real-ip') || null)?.slice(0, 45) ?? null;
}

export async function getUserAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}
