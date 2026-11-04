import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  listCandidaciesForRace,
  listPeopleForRace,
  getElection,
  getRace,
  listDistricts,
  listOffices,
  listParties,
  NotFoundError,
} from '@civicscope/cms';
import { can, racePartyRule } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { ActionButton } from '@/components/admin/form';
import { electionSteps, Steps } from '@/components/admin/steps';
import { AddCandidateTabs } from './add-candidate-tabs';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { CANDIDACY_STATUS_LABELS } from '@/lib/labels';
import {
  archiveAction,
  addNewCandidateAction,
  publishAction,
  publishWithCandidatesAction,
  createCandidacyAction,
  updateRaceAction,
} from '../../cms-actions';
import { CandidacyForm } from '../../candidacies/candidacy-form';
import { RaceForm } from '../race-form';

export const metadata: Metadata = { title: 'Race · CivicScope admin' };

export default async function RacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const created = (await searchParams).created === '1';
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const race = await getRace(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const election = await getElection(db, race.electionId);
  const [stateOffices, allOffices, districts, parties, candidacies, people] = await Promise.all([
    listOffices(db, { jurisdictionId: election.jurisdictionId }),
    listOffices(db),
    listDistricts(db, election.jurisdictionId),
    listParties(db),
    listCandidaciesForRace(db, id),
    listPeopleForRace(db, id),
  ]);
  const racePartyName = race.partyId
    ? (parties.find((p) => p.id === race.partyId)?.name ?? 'party')
    : null;
  const archived = Boolean(race.deletedAt);
  const published = race.publishState === 'published';

  const editable = can(user.role, 'content:edit') && !archived;
  const live = candidacies.filter((c) => !c.deletedAt);

  return (
    <>
      <p className="admin-crumbs">
        <Link href={`/admin/elections/${election.id}`}>← {election.name}</Link>
      </p>
      <header className="admin-page-head page-header">
        <div>
          <p className="admin-eyebrow">Race in {election.name}</p>
          <h1>
            {race.name} <PublishBadge state={race.publishState} />
          </h1>
        </div>
        <div className="toolbar">
          {!archived && (
            <Link href={`/admin/preview/races/${id}`} className="button secondary-link">
              Preview public page
            </Link>
          )}
          {published && (
            <Link href={`/races/${id}`} className="button secondary-link">
              View public page
            </Link>
          )}
          {can(user.role, 'content:publish') && !archived && (
            <ActionButton
              action={publishWithCandidatesAction.bind(null, 'race', id)}
              label="Publish with candidates"
              variant="primary"
              confirm="Publish this race and its election and its candidates? Each candidate is checked like a single publish; drafts only."
            />
          )}
          {can(user.role, 'content:publish') && !archived && (
            <ActionButton
              action={publishAction.bind(null, 'race', id, !published)}
              label={published ? 'Unpublish' : 'Publish'}
              variant="secondary"
            />
          )}
          {can(user.role, 'content:archive') && (
            <ActionButton
              action={archiveAction.bind(null, 'race', id, !archived)}
              label={archived ? 'Restore' : 'Archive'}
              variant={archived ? 'secondary' : 'danger'}
              confirm={
                archived
                  ? undefined
                  : 'Archive this race? It stays in the history and can be restored.'
              }
            />
          )}
        </div>
      </header>

      <Steps
        steps={electionSteps({
          electionId: election.id,
          races: 1,
          candidates: live.length,
          published,
          at: 'candidates',
        })}
      />

      {created && (
        <p role="status" className="notice success">
          Race added. Next, add the candidates running in it.
        </p>
      )}

      <section aria-labelledby="candidates-heading" className="admin-section">
        <div className="admin-section-head">
          <h2 id="candidates-heading">
            Candidates <span className="muted">({live.length})</span>
          </h2>
          {can(user.role, 'data:import') && !archived && (
            <Link href={`/admin/imports?race=${id}`}>Import candidates from a CSV file</Link>
          )}
        </div>
        {candidacies.length === 0 ? (
          <p className="admin-empty">No candidates yet. Add the first one below.</p>
        ) : (
          <div className="admin-card flush">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name on ballot</th>
                  <th scope="col">Party</th>
                  <th scope="col">Status</th>
                  <th scope="col">Published</th>
                  <th scope="col">
                    <span className="visually-hidden">Next step</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {candidacies.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/candidacies/${c.id}`}>
                        <strong>{c.ballotName}</strong>
                      </Link>
                      {c.isIncumbent && <span className="muted"> (incumbent)</span>}
                    </td>
                    <td>{c.partyName ?? '—'}</td>
                    <td>{c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'No status yet'}</td>
                    <td>
                      <PublishBadge state={c.publishState} />
                    </td>
                    <td className="row-action">
                      <Link href={`/admin/candidacies/${c.id}`}>Sources & status →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <details className="admin-card add-panel" open={candidacies.length === 0}>
            <summary className="add">Add a candidate</summary>
            <AddCandidateTabs
              existing={
                <CandidacyForm
                  action={createCandidacyAction.bind(null, id)}
                  people={people}
                  parties={parties}
                  racePartyName={racePartyName}
                  submitLabel="Add candidate"
                />
              }
              fresh={
                <CandidacyForm
                  action={addNewCandidateAction.bind(null, id)}
                  newPerson
                  parties={parties}
                  racePartyName={racePartyName}
                  submitLabel="Create person and add to race"
                />
              }
            />
          </details>
        )}
      </section>

      {editable && (
        <details className="admin-card add-panel">
          <summary>Edit race details</summary>
          <RaceForm
            action={updateRaceAction.bind(null, id)}
            offices={[...stateOffices, ...allOffices.filter((o) => o.level === 'federal')]}
            districts={districts}
            parties={parties}
            partyRule={racePartyRule(race.electionType, race.primarySystem)}
            race={race}
            submitLabel="Save changes"
          />
        </details>
      )}

      <History entityType="race" entityId={id} role={user.role} />
    </>
  );
}
