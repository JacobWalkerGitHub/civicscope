import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/lib/session';
import { createPersonAction } from '../../cms-actions';
import { PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'New person · CivicScope admin' };

export default async function NewPersonPage() {
  await requirePermission('content:edit');
  return (
    <>
      <p>
        <Link href="/admin/candidates">← Candidates</Link>
      </p>
      <h1>New person</h1>
      <p className="muted">
        Check the list first so the same person isn&apos;t added twice. New people start as drafts
        and need at least one source before they can be published.
      </p>
      <PersonForm action={createPersonAction} submitLabel="Create person" />
    </>
  );
}
