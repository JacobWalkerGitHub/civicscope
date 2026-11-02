import type { Metadata } from 'next';
import Link from 'next/link';
import { listIssues } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { ActionForm, TextField } from '@/components/admin/form';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';
import { createIssueAction } from '../cms-actions';

export const metadata: Metadata = { title: 'Issues · CivicScope admin' };

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requirePermission('admin:view');
  const showArchived = (await searchParams).archived === '1';
  const issues = await listIssues(getDb(), { includeArchived: showArchived });
  return (
    <>
      <h1>Issues</h1>
      <p className="muted">
        The policy areas that positions are filed under. Use plain, neutral names that every side
        would recognize.{' '}
        <Link href={showArchived ? '/admin/issues' : '/admin/issues?archived=1'}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Link>
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Issue</th>
            <th scope="col">Positions</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id}>
              <td>
                <Link href={`/admin/issues/${i.id}`}>{i.name}</Link>
                {i.deletedAt && <span className="muted"> (archived)</span>}
              </td>
              <td>{i.positionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {can(user.role, 'content:edit') && (
        <details className="add-form">
          <summary>Add an issue</summary>
          <ActionForm
            action={createIssueAction}
            submitLabel="Add issue"
            savedMessage="Issue added."
            resetOnSave
          >
            <TextField name="name" label="Name" required />
            <TextField name="description" label="Description (optional)" />
          </ActionForm>
        </details>
      )}
    </>
  );
}
