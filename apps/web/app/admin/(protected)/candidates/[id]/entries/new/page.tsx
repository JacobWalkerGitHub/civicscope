import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPerson, listIssues, NotFoundError } from '@civicscope/cms';
import { CLAIM_KINDS, type ClaimKind } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { CLAIM_KIND_LABELS } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { createClaimAction } from '../../../../cms-actions';
import { ClaimForm } from '../../../../claims/claim-form';

export const metadata: Metadata = { title: 'New profile entry · CivicScope admin' };

export default async function NewEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  await requirePermission('content:edit');
  const id = Number((await params).id);
  const kindParam = (await searchParams).kind;
  if (!CLAIM_KINDS.includes(kindParam as ClaimKind)) notFound();
  const kind = kindParam as ClaimKind;
  const db = getDb();
  const person = await getPerson(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <p>
        <Link href={`/admin/candidates/${id}`}>← {person.fullName}</Link>
      </p>
      <h1>
        New {CLAIM_KIND_LABELS[kind].toLowerCase()} entry for {person.fullName}
      </h1>
      <p className="muted">
        Save it as a draft, add its source on the next page, then send it for review. A reviewer
        approves it before it is published.
      </p>
      <ClaimForm
        action={createClaimAction.bind(null, id, kind)}
        kind={kind}
        issues={await listIssues(db)}
        submitLabel="Save draft"
      />
    </>
  );
}
