import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getElection,
  listDistricts,
  listOffices,
  listParties,
  listRaces,
  listDeadlines,
  listResources,
  listStates,
  NotFoundError,
} from '@civicscope/cms';
import { can, racePartyRule } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { ActionButton } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import {
  archiveAction,
  createRaceAction,
  publishAction,
  updateElectionAction,
} from '../../cms-actions';
import { RaceForm } from '../../races/race-form';
import { DeadlinesSection, ResourcesSection } from '../calendar-sections';
import { ElectionForm } from '../election-form';

export const metadata: Metadata = { title: 'Election · CivicScope admin' };

export default async function ElectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const election = await getElection(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [states, races, stateOffices, federalOffices, districts, parties, deadlines, resources] =
    await Promise.all([
      listStates(db),
      listRaces(db, id),
      listOffices(db, { jurisdictionId: election.jurisdictionId }),
      listOffices(db).then((all) => all.filter((o) => o.level === 'federal')),
      listDistricts(db, election.jurisdictionId),
      listParties(db),
      listDeadlines(db, id),
      listResources(db, election.jurisdictionId, { includeArchived: true }),
    ]);
  const stateName = states.find((s) => s.id === election.jurisdictionId)?.name ?? 'this state';
  const archived = Boolean(election.deletedAt);
  const published = election.publishState === 'published';

  return (
    <>
      <p>
        <Link href="/admin/elections">← Elections</Link>
      </p>
      <div className="page-header">
        <h1>{election.name}</h1>
        <PublishBadge state={election.publishState} />
      </div>
      <div className="toolbar">
        {can(user.role, 'content:publish') && !archived && (
          <ActionButton
            action={publishAction.bind(null, 'election', id, !published)}
            label={published ? 'Unpublish' : 'Publish'}
            variant={published ? 'secondary' : 'primary'}
          />
        )}
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'election', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={
              archived
                ? undefined
                : 'Archive this election? It stays in the history and can be restored.'
            }
          />
        )}
      </div>

      {can(user.role, 'content:edit') && !archived && (
        <ElectionForm
          action={updateElectionAction.bind(null, id)}
          states={states}
          election={election}
          submitLabel="Save changes"
        />
      )}

      <section aria-labelledby="races-heading">
        <h2 id="races-heading">Races</h2>
        {races.length === 0 ? (
          <p className="muted">No races yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Race</th>
                <th scope="col">Office</th>
                <th scope="col">District</th>
                <th scope="col">Party</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {races.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/races/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.officeTitle}</td>
                  <td>{r.districtLabel ?? 'Statewide'}</td>
                  <td>{r.partyName ?? '—'}</td>
                  <td>
                    <PublishBadge state={r.publishState} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {can(user.role, 'content:edit') && !archived && (
          <details className="add-race">
            <summary>Add a race</summary>
            <RaceForm
              action={createRaceAction.bind(null, id)}
              offices={[...stateOffices, ...federalOffices]}
              districts={districts}
              parties={parties}
              partyRule={racePartyRule(election.type, election.primarySystem)}
              submitLabel="Add race"
            />
          </details>
        )}
      </section>

      <DeadlinesSection
        electionId={id}
        deadlines={deadlines}
        role={user.role}
        published={published}
        archived={archived}
      />

      <ResourcesSection
        jurisdictionId={election.jurisdictionId}
        jurisdictionName={stateName}
        resources={resources}
        role={user.role}
      />

      <History entityType="election" entityId={id} role={user.role} />
    </>
  );
}
