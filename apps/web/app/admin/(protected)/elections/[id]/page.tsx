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
import { electionSteps, Steps } from '@/components/admin/steps';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { ELECTION_TYPE_LABELS, formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import {
  archiveAction,
  publishAction,
  publishWithCandidatesAction,
  createRaceAction,
  updateElectionAction,
} from '../../cms-actions';
import { RaceForm } from '../../races/race-form';
import { DeadlinesSection, ResourcesSection } from '../calendar-sections';
import { ElectionForm } from '../election-form';

export const metadata: Metadata = { title: 'Election · CivicScope admin' };

export default async function ElectionPage({
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

  const liveRaces = races.filter((r) => !r.deletedAt);
  const candidateTotal = liveRaces.reduce((n, r) => n + Number(r.candidateCount), 0);
  const editable = can(user.role, 'content:edit') && !archived;

  return (
    <>
      <p className="admin-crumbs">
        <Link href="/admin/elections">← Elections</Link>
      </p>
      <header className="admin-page-head page-header">
        <div>
          <p className="admin-eyebrow">Election</p>
          <h1>
            {election.name} <PublishBadge state={election.publishState} />
          </h1>
          <p className="muted">
            {stateName} · {formatDate(election.date)} · {ELECTION_TYPE_LABELS[election.type]}
          </p>
        </div>
        <div className="toolbar">
          {published && (
            <Link href={`/elections/${id}`} className="button secondary-link">
              View public page
            </Link>
          )}
          {can(user.role, 'content:publish') && !archived && (
            <ActionButton
              action={publishWithCandidatesAction.bind(null, 'election', id)}
              label="Publish with candidates"
              variant="primary"
              confirm="Publish this election and its races and candidates? Each candidate is checked like a single publish; drafts only."
            />
          )}
          {can(user.role, 'content:publish') && !archived && (
            <ActionButton
              action={publishAction.bind(null, 'election', id, !published)}
              label={published ? 'Unpublish' : 'Publish'}
              variant="secondary"
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
      </header>

      <Steps
        steps={electionSteps({
          electionId: id,
          races: liveRaces.length,
          candidates: candidateTotal,
          published,
          at: liveRaces.length ? 'candidates' : 'races',
        })}
      />

      {created && (
        <p role="status" className="notice success">
          Election created. Next, add the races on the ballot below.
        </p>
      )}

      <section aria-labelledby="races-heading" id="races" className="admin-section">
        <div className="admin-section-head">
          <h2 id="races-heading">
            Races <span className="muted">({liveRaces.length})</span>
          </h2>
        </div>
        {races.length === 0 ? (
          <p className="admin-empty">
            No races yet. Each office on the ballot (and, in a partisan primary, each party’s
            contest) is its own race.
          </p>
        ) : (
          <div className="admin-card flush">
            <table>
              <thead>
                <tr>
                  <th scope="col">Race</th>
                  <th scope="col">District</th>
                  <th scope="col">Party</th>
                  <th scope="col">Candidates</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Next step</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {races.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/races/${r.id}`}>
                        <strong>{r.name}</strong>
                      </Link>
                      <br />
                      <span className="muted small">{r.officeTitle}</span>
                    </td>
                    <td>{r.districtLabel ?? 'Statewide'}</td>
                    <td>{r.partyName ?? '—'}</td>
                    <td>{Number(r.candidateCount)}</td>
                    <td>
                      <PublishBadge state={r.publishState} />
                    </td>
                    <td className="row-action">
                      <Link href={`/admin/races/${r.id}`}>
                        {Number(r.candidateCount) ? 'Manage' : 'Add candidates'} →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <details className="admin-card add-panel" open={races.length === 0}>
            <summary className="add">Add a race</summary>
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

      {editable && (
        <details className="admin-card add-panel">
          <summary>Edit election details</summary>
          <ElectionForm
            action={updateElectionAction.bind(null, id)}
            states={states}
            election={election}
            submitLabel="Save changes"
          />
        </details>
      )}

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
