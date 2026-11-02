import type { Metadata } from 'next';
import Link from 'next/link';
import { listStates } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { createPartyAction } from '../../cms-actions';
import { PartyForm } from '../party-form';

export const metadata: Metadata = { title: 'New party · CivicScope admin' };

export default async function NewPartyPage() {
  await requirePermission('content:edit');
  return (
    <>
      <p>
        <Link href="/admin/parties">← Parties</Link>
      </p>
      <h1>New party</h1>
      <PartyForm
        action={createPartyAction}
        jurisdictions={await listStates(getDb())}
        submitLabel="Create party"
      />
    </>
  );
}
