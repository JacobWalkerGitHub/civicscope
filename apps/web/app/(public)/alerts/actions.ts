'use server';

import { redirect } from 'next/navigation';
import {
  alertsConfigFromEnv,
  CmsError,
  confirmFollow,
  requestFollow,
  unsubscribeFollow,
} from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formValues, type FormState } from '@/lib/admin-action';
import { getClientIp } from '@/lib/session';

/** The Follow form on member and bill pages. Anyone may send it. */
export async function followAction(_: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  // A field people never see. Bots fill it in; pretend it worked and store nothing.
  if (values.website) return { error: null, fieldErrors: {}, values: {}, saved: true };
  const alerts = alertsConfigFromEnv();
  if (!alerts) return { error: 'Email updates aren’t available yet.', fieldErrors: {}, values };
  try {
    await requestFollow(getDb(), values, { ipAddress: await getClientIp(), alerts });
  } catch (error) {
    if (error instanceof CmsError) {
      return { error: error.message, fieldErrors: error.fieldErrors, values };
    }
    throw error;
  }
  return { error: null, fieldErrors: {}, values: {}, saved: true };
}

const linkParams = (formData: FormData) => {
  const f = String(formData.get('f') ?? '');
  const t = String(formData.get('t') ?? '');
  return { f, t, id: Number(f) };
};

export async function confirmFollowAction(formData: FormData): Promise<void> {
  const { f, t, id } = linkParams(formData);
  await confirmFollow(getDb(), id, t);
  redirect(`/alerts/confirm?f=${encodeURIComponent(f)}&t=${encodeURIComponent(t)}`);
}

export async function unsubscribeAction(formData: FormData): Promise<void> {
  const link = {
    f: String(formData.get('f') ?? ''),
    e: String(formData.get('e') ?? ''),
    t: String(formData.get('t') ?? ''),
  };
  const all = formData.get('all') === '1';
  const res = await unsubscribeFollow(getDb(), link, { all });
  const done = res ? (all || link.e ? 'all' : '1') : 'gone';
  redirect(`/alerts/unsubscribe?done=${done}`);
}
