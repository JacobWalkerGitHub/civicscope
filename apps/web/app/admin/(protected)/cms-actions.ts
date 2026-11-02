'use server';

import { redirect } from 'next/navigation';
import {
  addCitation,
  addPersonIdentifier,
  addStatusEvent,
  createCandidacy,
  createPerson,
  removeCitation,
  removePersonIdentifier,
  setCandidacyArchived,
  setCandidacyPublishState,
  setPersonArchived,
  setPersonPublishState,
  setSourceArchived,
  updateCandidacy,
  updatePerson,
  updateSource,
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

type PublishableEntity = 'election' | 'race' | 'person' | 'candidacy';

export async function publishAction(
  entityType: PublishableEntity,
  id: number,
  publish: boolean,
  _: FormState,
) {
  const state = publish ? 'published' : 'unpublished';
  return runButtonAction('content:publish', (actor) => {
    const db = getDb();
    switch (entityType) {
      case 'person':
        return setPersonPublishState(db, actor, id, state);
      case 'candidacy':
        return setCandidacyPublishState(db, actor, id, state);
      default:
        return setPublishState(db, actor, entityType, id, state);
    }
  });
}

export async function archiveAction(
  entityType: PublishableEntity | 'source',
  id: number,
  archived: boolean,
  _: FormState,
) {
  return runButtonAction('content:archive', (actor) => {
    const db = getDb();
    switch (entityType) {
      case 'person':
        return setPersonArchived(db, actor, id, archived);
      case 'candidacy':
        return setCandidacyArchived(db, actor, id, archived);
      case 'source':
        return setSourceArchived(db, actor, id, archived);
      default:
        return setArchived(db, actor, entityType, id, archived);
    }
  });
}

// People and candidacies

export async function createPersonAction(_: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createPerson(getDb(), actor, values);
  });
  if (state.saved) redirect(`/admin/candidates/${id}?created=1`);
  return state;
}

export async function updatePersonAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updatePerson(getDb(), actor, id, values),
  );
}

export async function addIdentifierAction(personId: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, async (actor, values) => {
    await addPersonIdentifier(getDb(), actor, personId, values);
  });
}

export async function removeIdentifierAction(id: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => removePersonIdentifier(getDb(), actor, id));
}

export async function createCandidacyAction(raceId: number, _: FormState, formData: FormData) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createCandidacy(getDb(), actor, { ...values, raceId });
  });
  if (state.saved) redirect(`/admin/candidacies/${id}?created=1`);
  return state;
}

export async function updateCandidacyAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateCandidacy(getDb(), actor, id, values),
  );
}

export async function addStatusEventAction(candidacyId: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    addStatusEvent(getDb(), actor, candidacyId, values),
  );
}

// Sources and citations

export async function addCitationAction(
  subjectType: 'person' | 'candidacy',
  subjectId: number,
  _: FormState,
  formData: FormData,
) {
  return runFormAction('content:edit', formData, async (actor, values) => {
    await addCitation(getDb(), actor, { ...values, subjectType, subjectId });
  });
}

export async function removeCitationAction(id: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => removeCitation(getDb(), actor, id));
}

export async function updateSourceAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateSource(getDb(), actor, id, values),
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
