import 'server-only';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { UserInputError, type SessionUser } from '@civicscope/auth';
import type { Permission } from '@civicscope/core';
import { requirePermission } from './session';

/** Result of an account or user-management form. */
export interface AuthFormState {
  error: string | null;
  saved?: boolean;
  /** Recovery codes, shown once right after they are created. */
  codes?: string[];
  /** An invitation link, shown once right after it is created. */
  link?: string;
}

export const emptyAuthState: AuthFormState = { error: null };

/** Checks the permission on the server and turns UserInputErrors into form messages. */
export async function runAuthAction(
  permission: Permission,
  write: (user: SessionUser) => Promise<Partial<AuthFormState> | void>,
  { allowWithoutTwoStep = false, revalidate = true } = {},
): Promise<AuthFormState> {
  const user = await requirePermission(permission, { allowWithoutTwoStep });
  try {
    const extra = await write(user);
    // Forms that show one-time secrets skip this, so the page doesn't re-render and
    // replace the form before the person has copied them.
    if (revalidate) revalidatePath('/admin', 'layout');
    return { error: null, saved: true, ...(extra ?? {}) };
  } catch (error) {
    if (error instanceof UserInputError) return { error: error.message };
    throw error;
  }
}

/** This site's origin as the browser sees it, for building links. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
