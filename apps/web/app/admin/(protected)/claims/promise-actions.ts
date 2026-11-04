'use server';

import { addPromiseLink, removePromiseLink } from '@civicscope/cms';
import { runButtonAction, runFormAction, type FormState } from '@/lib/admin-action';
import { getDb } from '@/lib/db';

export async function addPromiseLinkAction(claimId: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, async (actor, values) => {
    await addPromiseLink(getDb(), actor, claimId, values);
  });
}

export async function removePromiseLinkAction(linkId: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => removePromiseLink(getDb(), actor, linkId));
}
