import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOffice, listOfficeJurisdictions, NotFoundError } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { ActionButton } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { archiveOfficeAction, updateOfficeAction } from '../../cms-actions';
import { OfficeForm } from '../office-form';

export const metadata: Metadata = { title: 'Office · CivicScope admin' };

export default async function OfficePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const office = await getOffice(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <p>
        <Link href="/admin/offices">← Offices</Link>
      </p>
      <div className="page-header">
        <h1>{office.title}</h1>
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveOfficeAction.bind(null, id, !office.deletedAt)}
            label={office.deletedAt ? 'Restore' : 'Archive'}
            variant={office.deletedAt ? 'secondary' : 'danger'}
            confirm={
              office.deletedAt
                ? undefined
                : 'Archive this office? It stays in the history and can be restored.'
            }
          />
        )}
      </div>
      {office.deletedAt && <p className="notice">This office is archived.</p>}
      {can(user.role, 'content:edit') && (
        <OfficeForm
          action={updateOfficeAction.bind(null, id)}
          jurisdictions={await listOfficeJurisdictions(db)}
          office={office}
          submitLabel="Save changes"
        />
      )}
      <History entityType="office" entityId={id} role={user.role} />
    </>
  );
}
