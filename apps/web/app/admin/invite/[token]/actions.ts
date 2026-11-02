'use server';

import { redirect } from 'next/navigation';
import { acceptInvite, UserInputError } from '@civicscope/auth';
import { getDb } from '@/lib/db';
import { getClientIp } from '@/lib/session';

export interface AcceptState {
  error: string | null;
  name: string;
}

export async function acceptInviteAction(
  token: string,
  _: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const name = String(formData.get('name') ?? '');
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('confirm') ?? '')) {
    return { error: 'The passwords don’t match.', name };
  }
  try {
    await acceptInvite(getDb(), token, { name, password }, { ipAddress: await getClientIp() });
  } catch (error) {
    if (error instanceof UserInputError) return { error: error.message, name };
    throw error;
  }
  redirect('/admin/sign-in?welcome=1');
}
