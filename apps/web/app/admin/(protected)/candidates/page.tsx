import type { Metadata } from 'next';
import Link from 'next/link';
import { listPeople } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Candidates · CivicScope admin' };

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const user = await requirePermission('admin:view');
  const params = await searchParams;
  const people = await listPeople(getDb(), {
    query: params.q,
    includeArchived: params.archived === '1',
  });

  return (
    <>
      <div className="page-header">
        <h1>Candidates</h1>
        {can(user.role, 'content:edit') && (
          <Link href="/admin/candidates/new" className="button">
            New person
          </Link>
        )}
      </div>
      <p className="muted">
        A person is listed once, however many times they run. Add them to a race from the
        race&apos;s page.
      </p>
      <form className="filters" method="get" role="search">
        <label>
          Name
          <input name="q" type="search" defaultValue={params.q ?? ''} />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={params.archived === '1'}
          />{' '}
          Include archived
        </label>
        <button type="submit" className="secondary">
          Search
        </button>
      </form>
      {people.length === 0 ? (
        <p className="muted">No people found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Candidacies</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/candidates/${p.id}`}>{p.sortName}</Link>
                </td>
                <td>{p.candidacyCount}</td>
                <td>
                  <PublishBadge state={p.publishState} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
