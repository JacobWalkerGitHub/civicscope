'use server';

import { revalidatePath } from 'next/cache';
import { CmsError, importPersonPhoto, removePersonPhoto, uploadPersonPhoto } from '@civicscope/cms';
import { MAX_PHOTO_BYTES } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { formValues, runButtonAction, runFormAction, type FormState } from '@/lib/admin-action';
import { getClientIp, requirePermission } from '@/lib/session';

export async function uploadPhotoAction(
  personId: number,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requirePermission('content:edit');
  const values = formValues(formData);
  const file = formData.get('file');
  try {
    if (!(file instanceof File) || file.size === 0) {
      throw new CmsError('Choose a photo to upload.', { file: 'Choose a photo.' });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new CmsError('Photos can be up to 5 MB.', { file: 'Up to 5 MB, please.' });
    }
    await uploadPersonPhoto(
      getDb(),
      { userId: user.id, ipAddress: await getClientIp() },
      personId,
      Buffer.from(await file.arrayBuffer()),
      values,
    );
  } catch (error) {
    if (error instanceof CmsError) {
      return { error: error.message, fieldErrors: error.fieldErrors, values };
    }
    throw error;
  }
  revalidatePath('/', 'layout');
  return { error: null, fieldErrors: {}, values: {}, saved: true };
}

export async function linkPhotoAction(personId: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, async (actor, values) => {
    await importPersonPhoto(getDb(), actor, personId, values);
  });
}

export async function removePhotoAction(personId: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => removePersonPhoto(getDb(), actor, personId));
}
