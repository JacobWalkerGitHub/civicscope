import 'server-only';
import { revalidatePath } from 'next/cache';
import { CmsError, type Actor } from '@civicscope/cms';
import type { Permission } from '@civicscope/core';
import { getClientIp, requirePermission } from './session';

export interface FormState {
  error: string | null;
  fieldErrors: Record<string, string>;
  /** What the user submitted, so the form keeps their input after an error. */
  values: Record<string, string>;
  saved?: boolean;
  /** A result to show next to a button, e.g. what a bulk action did. */
  message?: string;
}

export const emptyFormState: FormState = { error: null, fieldErrors: {}, values: {} };

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && !key.startsWith('$')) out[key] = value;
  }
  return out;
}

/**
 * Runs a CMS write for a form submission: checks the permission on the server, passes
 * the signed-in admin as the actor, and turns CmsErrors into messages for the form.
 */
export async function runFormAction(
  permission: Permission,
  formData: FormData,
  write: (actor: Actor, values: Record<string, string>) => Promise<void>,
): Promise<FormState> {
  const user = await requirePermission(permission);
  const values = formValues(formData);
  try {
    await write({ userId: user.id, ipAddress: await getClientIp() }, values);
  } catch (error) {
    if (error instanceof CmsError) {
      return { error: error.message, fieldErrors: error.fieldErrors, values };
    }
    throw error;
  }
  // Refresh the admin and the public site, so a publish shows to readers at once.
  revalidatePath('/', 'layout');
  return { error: null, fieldErrors: {}, values, saved: true };
}

/**
 * Same as runFormAction, for buttons (publish, archive, restore). They report errors,
 * and a message when the write returns one.
 */
export async function runButtonAction(
  permission: Permission,
  write: (actor: Actor) => Promise<void | string>,
): Promise<FormState> {
  const user = await requirePermission(permission);
  let message: string | void;
  try {
    message = await write({ userId: user.id, ipAddress: await getClientIp() });
  } catch (error) {
    if (error instanceof CmsError) return { ...emptyFormState, error: error.message };
    throw error;
  }
  // Refresh the admin and the public site, so a publish shows to readers at once.
  revalidatePath('/', 'layout');
  return { ...emptyFormState, saved: true, ...(message ? { message } : {}) };
}
