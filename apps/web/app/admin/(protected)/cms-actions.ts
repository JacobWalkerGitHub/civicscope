'use server';

import { redirect } from 'next/navigation';
import {
  approveClaim,
  createClaim,
  createIssue,
  republishClaim,
  sendClaimBack,
  setClaimArchived,
  setIssueArchived,
  submitClaimForReview,
  unpublishClaim,
  updateClaim,
  updateIssue,
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
  createDeadline,
  createResource,
  markResourceChecked,
  removeDeadline,
  setResourceArchived,
  updateDeadline,
  updateResource,
  getDeadline,
  getElection,
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

// Election calendar: key dates and official links.
// Dates and links have no draft state of their own: once their election is published
// they show at once. So changing a published election's dates, or any state's official
// links (shown on every published election there), needs the right to publish.

async function deadlinePermission(electionId: number) {
  const e = await getElection(getDb(), electionId);
  return e.publishState === 'published' ? 'content:publish' : 'content:edit';
}

/** Looked up from the date itself, never from what the browser sends. */
async function electionOfDeadline(id: number) {
  return (await getDeadline(getDb(), id)).electionId;
}

export async function createDeadlineAction(electionId: number, _: FormState, formData: FormData) {
  return runFormAction(await deadlinePermission(electionId), formData, async (actor, values) => {
    await createDeadline(getDb(), actor, { ...values, electionId });
  });
}

export async function updateDeadlineAction(id: number, _: FormState, formData: FormData) {
  const electionId = await electionOfDeadline(id);
  return runFormAction(await deadlinePermission(electionId), formData, (actor, values) =>
    updateDeadline(getDb(), actor, id, values),
  );
}

export async function removeDeadlineAction(id: number, _: FormState) {
  const permission = await deadlinePermission(await electionOfDeadline(id));
  return runButtonAction(permission === 'content:edit' ? 'content:archive' : permission, (actor) =>
    removeDeadline(getDb(), actor, id),
  );
}

export async function createResourceAction(
  jurisdictionId: number,
  _: FormState,
  formData: FormData,
) {
  return runFormAction('content:publish', formData, async (actor, values) => {
    await createResource(getDb(), actor, { ...values, jurisdictionId });
  });
}

export async function updateResourceAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:publish', formData, (actor, values) =>
    updateResource(getDb(), actor, id, values),
  );
}

export async function checkResourceAction(id: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => markResourceChecked(getDb(), actor, id));
}

export async function archiveResourceAction(id: number, archived: boolean, _: FormState) {
  return runButtonAction('content:publish', (actor) =>
    setResourceArchived(getDb(), actor, id, archived),
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
  entityType: PublishableEntity | 'source' | 'claim' | 'issue',
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
      case 'claim':
        return setClaimArchived(db, actor, id, archived);
      case 'issue':
        return setIssueArchived(db, actor, id, archived);
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
  subjectType: 'person' | 'candidacy' | 'claim',
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

// Profile entries and review

export async function createClaimAction(
  personId: number,
  kind: string,
  _: FormState,
  formData: FormData,
) {
  let id = 0;
  const state = await runFormAction('content:edit', formData, async (actor, values) => {
    id = await createClaim(getDb(), actor, { ...values, personId, kind });
  });
  if (state.saved) redirect(`/admin/claims/${id}?created=1`);
  return state;
}

export async function updateClaimAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateClaim(getDb(), actor, id, values),
  );
}

export async function submitClaimAction(id: number, _: FormState) {
  return runButtonAction('content:edit', (actor) => submitClaimForReview(getDb(), actor, id));
}

export async function approveClaimAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:publish', formData, (actor, values) =>
    approveClaim(getDb(), actor, id, values.note),
  );
}

export async function sendClaimBackAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:publish', formData, (actor, values) =>
    sendClaimBack(getDb(), actor, id, values.note ?? ''),
  );
}

export async function claimPublishAction(id: number, publish: boolean, _: FormState) {
  return runButtonAction('content:publish', (actor) =>
    publish ? republishClaim(getDb(), actor, id) : unpublishClaim(getDb(), actor, id),
  );
}

// Issues

export async function createIssueAction(_: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, async (actor, values) => {
    await createIssue(getDb(), actor, values);
  });
}

export async function updateIssueAction(id: number, _: FormState, formData: FormData) {
  return runFormAction('content:edit', formData, (actor, values) =>
    updateIssue(getDb(), actor, id, values),
  );
}
