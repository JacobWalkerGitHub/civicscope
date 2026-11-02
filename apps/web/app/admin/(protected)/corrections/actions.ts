'use server';

import { removeCoverage, resolveCorrectionRequest, setCoverage } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { runButtonAction, runFormAction, type FormState } from '@/lib/admin-action';

export async function resolveCorrectionAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:publish', formData, (actor, values) =>
    resolveCorrectionRequest(getDb(), actor, id, values),
  );
}

export async function setCoverageAction(_: FormState, formData: FormData) {
  return runFormAction('content:publish', formData, async (actor, values) => {
    await setCoverage(getDb(), actor, values);
  });
}

export async function removeCoverageAction(id: number, _: FormState) {
  return runButtonAction('content:publish', (actor) => removeCoverage(getDb(), actor, id));
}
