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
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { CANDIDACY_STATUS_LABELS } from '@/lib/labels';
import {
  archiveAction,
  createCandidacyAction,
  publishAction,
  updateRaceAction,
} from '../../cms-actions';
import { CandidacyForm } from '../../candidacies/candidacy-form';
import { RaceForm } from '../race-form';

export const metadata: Metadata = { title: 'Race · CivicScope admin' };

export default async function RacePage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <>
      <p>
        <Link href={`/admin/elections/${election.id}`}>← {election.name}</Link>
      </p>
      <div className="page-header">
        <h1>{race.name}</h1>
        <PublishBadge state={race.publishState} />
      </div>
      <div className="toolbar">
        {!archived && (
          <Link href={`/admin/preview/races/${id}`} className="button">
            Preview public page
          </Link>
        )}
        {published && (
          <Link href={`/races/${id}`} className="button">
            View public page
          </Link>
        )}
        {can(user.role, 'content:publish') && !archived && (
          <ActionButton
            action={publishAction.bind(null, 'race', id, !published)}
            label={published ? 'Unpublish' : 'Publish'}
            variant={published ? 'secondary' : 'primary'}
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
      {can(user.role, 'content:edit') && !archived && (
        <RaceForm
          action={updateRaceAction.bind(null, id)}
          offices={[...stateOffices, ...allOffices.filter((o) => o.level === 'federal')]}
          districts={districts}
          parties={parties}
          partyRule={racePartyRule(race.electionType, race.primarySystem)}
          race={race}
          submitLabel="Save changes"
        />
      )}
      <section aria-labelledby="candidates-heading">
        <h2 id="candidates-heading">Candidates</h2>
        {candidacies.length === 0 ? (
          <p className="muted">No candidates yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Name on ballot</th>
                <th scope="col">Party</th>
                <th scope="col">Status</th>
                <th scope="col">Published</th>
              </tr>
            </thead>
            <tbody>
              {candidacies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/candidacies/${c.id}`}>{c.ballotName}</Link>
                    {c.isIncumbent && <span className="muted"> (incumbent)</span>}
                  </td>
                  <td>{c.partyName ?? '—'}</td>
                  <td>{c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'No status yet'}</td>
                  <td>
                    <PublishBadge state={c.publishState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {can(user.role, 'data:import') && !archived && (
          <p>
            <Link href={`/admin/imports?race=${id}`}>Import candidates from a CSV file</Link>
          </p>
        )}
        {can(user.role, 'content:edit') && !archived && (
          <details className="add-form">
            <summary>Add a candidate</summary>
            <CandidacyForm
              action={createCandidacyAction.bind(null, id)}
              people={people}
              parties={parties}
              racePartyName={racePartyName}
              submitLabel="Add candidate"
            />
          </details>
        )}
      </section>

      <History entityType="race" entityId={id} role={user.role} />
    </>
  );
}
