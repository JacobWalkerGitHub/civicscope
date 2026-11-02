import type { Metadata } from 'next';
import Link from 'next/link';
import { listStates } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { createElectionAction } from '../../cms-actions';
import { ElectionForm } from '../election-form';

export const metadata: Metadata = { title: 'New election · CivicScope admin' };

export default async function NewElectionPage() {
  await requirePermission('content:edit');
  return (
    <>
      <p>
        <Link href="/admin/elections">← Elections</Link>
      </p>
      <h1>New election</h1>
      <p className="muted">
        New elections start as drafts. They appear publicly only after a reviewer publishes them.
      </p>
      <ElectionForm
        action={createElectionAction}
        states={await listStates(getDb())}
        submitLabel="Create election"
      />
    </>
  );
}
