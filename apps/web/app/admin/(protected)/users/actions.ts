'use server';

import {
  changeUserRole,
  createInvite,
  resetUserTwoStep,
  revokeInvite,
  setUserDisabled,
  type SessionUser,
} from '@civicscope/auth';
import { getDb } from '@/lib/db';
import { runAuthAction, siteOrigin, type AuthFormState } from '@/lib/auth-action';
import { getClientIp } from '@/lib/session';

/* Every action here is owner-only ("users:manage"), checked on the server. */

async function actor(user: SessionUser) {
  return {
    type: 'user' as const,
    id: String(user.id),
    userId: user.id,
    ipAddress: await getClientIp(),
  };
}

export async function inviteAction(_: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return runAuthAction('users:manage', async (user) => {
    const { token } = await createInvite(
      getDb(),
      { email: String(formData.get('email') ?? ''), role: String(formData.get('role') ?? '') },
      await actor(user),
    );
    return { link: `${await siteOrigin()}/admin/invite/${token}` };
  });
}

export async function revokeInviteAction(id: number, _: AuthFormState): Promise<AuthFormState> {
  return runAuthAction('users:manage', async (user) =>
    revokeInvite(getDb(), id, await actor(user)),
  );
}

export async function changeRoleAction(
  userId: number,
  _: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  return runAuthAction('users:manage', async (user) =>
    changeUserRole(getDb(), userId, String(formData.get('role') ?? ''), await actor(user)),
  );
}

export async function setDisabledAction(
  userId: number,
  disabled: boolean,
  _: AuthFormState,
): Promise<AuthFormState> {
  return runAuthAction('users:manage', async (user) =>
    setUserDisabled(getDb(), userId, disabled, await actor(user)),
  );
}

export async function resetTwoStepAction(userId: number, _: AuthFormState): Promise<AuthFormState> {
  return runAuthAction('users:manage', async (user) =>
    resetUserTwoStep(getDb(), userId, await actor(user)),
  );
}
