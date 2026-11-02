'use server';

import {
  beginTwoStepSetup,
  changeOwnPassword,
  confirmTwoStepSetup,
  regenerateRecoveryCodes,
  UserInputError,
} from '@civicscope/auth';
import { getDb } from '@/lib/db';
import { runAuthAction, type AuthFormState } from '@/lib/auth-action';
import { getClientIp, getSessionToken } from '@/lib/session';

// The account page must work before two-step sign-in is set up, since it is where
// that happens; every action still requires a signed-in user.
const open = { allowWithoutTwoStep: true };
const showsCodes = { ...open, revalidate: false };

export async function startTwoStepAction(_: AuthFormState): Promise<AuthFormState> {
  return runAuthAction(
    'admin:view',
    async (user) => {
      await beginTwoStepSetup(getDb(), user.id);
    },
    open,
  );
}

export async function confirmTwoStepAction(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  return runAuthAction(
    'admin:view',
    async (user) => ({
      codes: await confirmTwoStepSetup(getDb(), user.id, String(formData.get('code') ?? ''), {
        ipAddress: await getClientIp(),
      }),
    }),
    showsCodes,
  );
}

export async function regenerateCodesAction(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  return runAuthAction(
    'admin:view',
    async (user) => ({
      codes: await regenerateRecoveryCodes(getDb(), user.id, String(formData.get('code') ?? '')),
    }),
    showsCodes,
  );
}

export async function changePasswordAction(
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  return runAuthAction(
    'admin:view',
    async (user) => {
      const next = String(formData.get('next') ?? '');
      if (next !== String(formData.get('confirm') ?? '')) {
        throw new UserInputError('The new passwords don’t match.');
      }
      await changeOwnPassword(
        getDb(),
        user.id,
        { current: String(formData.get('current') ?? ''), next },
        await getSessionToken(),
      );
    },
    open,
  );
}
