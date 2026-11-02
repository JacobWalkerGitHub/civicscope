import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getIssue, NotFoundError } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { ActionButton, ActionForm, TextField } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { archiveAction, updateIssueAction } from '../../cms-actions';

export const metadata: Metadata = { title: 'Issue · CivicScope admin' };

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const issue = await getIssue(getDb(), id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const archived = Boolean(issue.deletedAt);
  return (
    <>
      <p>
        <Link href="/admin/issues">← Issues</Link>
      </p>
      <div className="page-header">
        <h1>{issue.name}</h1>
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'issue', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={archived ? undefined : 'Archive this issue?'}
          />
        )}
      </div>
      {can(user.role, 'content:edit') && !archived && (
        <ActionForm action={updateIssueAction.bind(null, id)} submitLabel="Save changes">
          <TextField name="name" label="Name" defaultValue={issue.name} required />
          <TextField
            name="description"
            label="Description (optional)"
            defaultValue={issue.description}
          />
        </ActionForm>
      )}
      <History entityType="issue" entityId={id} role={user.role} />
    </>
  );
}
