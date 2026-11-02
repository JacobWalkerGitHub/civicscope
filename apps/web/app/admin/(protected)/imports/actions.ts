'use server';

import { redirect } from 'next/navigation';
import {
  applyImport,
  CmsError,
  createCandidateImport,
  discardImport,
  MAX_IMPORT_BYTES,
  resolveConflict,
  unlockField,
} from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { formValues, runButtonAction, runFormAction, type FormState } from '@/lib/admin-action';
import { getClientIp, requirePermission } from '@/lib/session';

/** Uploads a CSV for preview. Only reviewers and the owner can import. */
export async function uploadImportAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission('data:import');
  const values = formValues(formData);
  const file = formData.get('file');
  let id: number;
  try {
    if (!(file instanceof File) || file.size === 0) {
      throw new CmsError('Choose a CSV file to upload.', { file: 'Choose a CSV file.' });
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new CmsError('The file is too large. Split it into smaller files.', {
        file: 'Under 900 KB, please.',
      });
    }
    id = await createCandidateImport(
      getDb(),
      { userId: user.id, ipAddress: await getClientIp() },
      { ...values, fileName: file.name, csvText: await file.text() },
    );
  } catch (error) {
    if (error instanceof CmsError) {
      return { error: error.message, fieldErrors: error.fieldErrors, values };
    }
    throw error;
  }
  redirect(`/admin/imports/${id}`);
}

export async function applyImportAction(id: number, _: FormState) {
  return runButtonAction('data:import', async (actor) => {
    await applyImport(getDb(), actor, id);
  });
}

export async function discardImportAction(id: number, _: FormState) {
  return runButtonAction('data:import', (actor) => discardImport(getDb(), actor, id));
}

export async function resolveConflictAction(
  id: number,
  decision: 'accept' | 'reject',
  _: FormState,
  formData: FormData,
) {
  return runFormAction('data:import', formData, (actor, values) =>
    resolveConflict(getDb(), actor, id, decision, values.note?.trim() || null),
  );
}

export async function unlockFieldAction(lockId: number, _: FormState) {
  return runButtonAction('data:import', (actor) => unlockField(getDb(), actor, lockId));
}
