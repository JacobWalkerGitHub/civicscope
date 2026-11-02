'use server';

import { redirect } from 'next/navigation';
import {
  createElection,
  createOffice,
  createParty,
  createRace,
  isRestorable,
  restoreRevision,
  setArchived,
  setOfficeArchived,
  setPartyArchived,
  setPublishState,
  updateElection,
  updateOffice,
  updateParty,
  updateRace,
} from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { runButtonAction, runFormAction, type FormState } from '@/lib/admin-action';

/*
 * Every admin write goes through runFormAction/runButtonAction, which check the
 * signed-in user's permission on the server before anything is changed.
 */

// Parties

export async function createPartyAction(_: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createParty(getDb(), actor, values);
  });
  if (state.saved) redirect(`/admin/parties/${id}?created=1`);
  return state;
}

export async function updatePartyAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateParty(getDb(), actor, id, values),
  );
}

export async function archivePartyAction(id: number, archived: boolean, _: FormState) {
  return runButtonAction('content:archive', (actor) =>
    setPartyArchived(getDb(), actor, id, archived),
  );
}

// Offices

export async function createOfficeAction(_: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createOffice(getDb(), actor, values);
  });
  if (state.saved) redirect(`/admin/offices/${id}?created=1`);
  return state;
}

export async function updateOfficeAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateOffice(getDb(), actor, id, values),
  );
}

export async function archiveOfficeAction(id: number, archived: boolean, _: FormState) {
  return runButtonAction('content:archive', (actor) =>
    setOfficeArchived(getDb(), actor, id, archived),
  );
}

// Elections and races

export async function createElectionAction(_: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createElection(getDb(), actor, values);
  });
  if (state.saved) redirect(`/admin/elections/${id}?created=1`);
  return state;
}

export async function updateElectionAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateElection(getDb(), actor, id, values),
  );
}

export async function createRaceAction(electionId: number, _: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createRace(getDb(), actor, { ...values, electionId });
  });
  if (state.saved) redirect(`/admin/races/${id}?created=1`);
  return state;
}

export async function updateRaceAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateRace(getDb(), actor, id, values),
  );
}

export async function publishAction(
  entityType: 'election' | 'race',
  id: number,
  publish: boolean,
  _: FormState,
) {
  return runButtonAction('content:publish', (actor) =>
    setPublishState(getDb(), actor, entityType, id, publish ? 'published' : 'unpublished'),
  );
}

export async function archiveAction(
  entityType: 'election' | 'race',
  id: number,
  archived: boolean,
  _: FormState,
) {
  return runButtonAction('content:archive', (actor) =>
    setArchived(getDb(), actor, entityType, id, archived),
  );
}

// History

export async function restoreVersionAction(
  entityType: string,
  id: number,
  version: number,
  _: FormState,
) {
  if (!isRestorable(entityType)) throw new Error('Not restorable');
  return runButtonAction('content:edit', (actor) =>
    restoreRevision(getDb(), actor, entityType, id, version),
  );
}
