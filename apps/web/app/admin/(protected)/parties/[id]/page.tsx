import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getParty, listStates, NotFoundError } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { ActionButton } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { archivePartyAction, updatePartyAction } from '../../cms-actions';
import { PartyForm } from '../party-form';

export const metadata: Metadata = { title: 'Party · CivicScope admin' };

export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const party = await getParty(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <p>
        <Link href="/admin/parties">← Parties</Link>
      </p>
      <div className="page-header">
        <h1>{party.name}</h1>
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archivePartyAction.bind(null, id, !party.deletedAt)}
            label={party.deletedAt ? 'Restore' : 'Archive'}
            variant={party.deletedAt ? 'secondary' : 'danger'}
            confirm={
              party.deletedAt
                ? undefined
                : 'Archive this party? It stays in the history and can be restored.'
            }
          />
        )}
      </div>
      {party.deletedAt && <p className="notice">This party is archived.</p>}
      {can(user.role, 'content:edit') ? (
        <PartyForm
          action={updatePartyAction.bind(null, id)}
          jurisdictions={await listStates(db)}
          party={party}
          submitLabel="Save changes"
        />
      ) : (
        <dl>
          <dt>Short name</dt>
          <dd>{party.shortName ?? '—'}</dd>
          <dt>FEC code</dt>
          <dd>{party.fecCode ?? '—'}</dd>
        </dl>
      )}
      <History entityType="party" entityId={id} role={user.role} />
    </>
  );
}
