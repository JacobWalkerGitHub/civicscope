import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
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
import { archiveAction, publishAction, updateRaceAction } from '../../cms-actions';
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
  const [stateOffices, allOffices, districts, parties] = await Promise.all([
    listOffices(db, { jurisdictionId: election.jurisdictionId }),
    listOffices(db),
    listDistricts(db, election.jurisdictionId),
    listParties(db),
  ]);
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
      <History entityType="race" entityId={id} role={user.role} />
    </>
  );
}
