import type { Metadata } from 'next';
import Link from 'next/link';
import { listOfficeJurisdictions } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { createOfficeAction } from '../../cms-actions';
import { OfficeForm } from '../office-form';

export const metadata: Metadata = { title: 'New office · CivicScope admin' };

export default async function NewOfficePage() {
  await requirePermission('content:edit');
  return (
    <>
      <p>
        <Link href="/admin/offices">← Offices</Link>
      </p>
      <h1>New office</h1>
      <OfficeForm
        action={createOfficeAction}
        jurisdictions={await listOfficeJurisdictions(getDb())}
        submitLabel="Create office"
      />
    </>
  );
}
