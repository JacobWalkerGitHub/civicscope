'use server';

import { CmsError, submitCorrectionRequest } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formValues, type FormState } from '@/lib/admin-action';
import { getClientIp } from '@/lib/session';

/** The public correction form. Anyone may send it, so nothing here needs a session. */
export async function submitCorrectionAction(_: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  // A field people never see. Bots fill it in; pretend it worked and store nothing.
  if (values.website) return { error: null, fieldErrors: {}, values: {}, saved: true };
  try {
    await submitCorrectionRequest(getDb(), values, { ipAddress: await getClientIp() });
  } catch (error) {
    if (error instanceof CmsError) {
      return { error: error.message, fieldErrors: error.fieldErrors, values };
    }
    throw error;
  }
  return { error: null, fieldErrors: {}, values: {}, saved: true };
}
