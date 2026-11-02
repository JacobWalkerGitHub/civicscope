import type { Metadata } from 'next';
import Link from 'next/link';
import { listSources } from '@civicscope/cms';
import { sourceTier } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { formatDate, SOURCE_TYPE_LABELS } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Sources · CivicScope admin' };

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  await requirePermission('admin:view');
  const params = await searchParams;
  const sources = await listSources(getDb(), {
    query: params.q,
    includeArchived: params.archived === '1',
  });

  return (
    <>
      <h1>Sources</h1>
      <p className="muted">
        Every document cited anywhere in CivicScope. Sources are added by citing them from a
        candidate or candidacy page; one source can back many facts.
      </p>
      <form className="filters" method="get" role="search">
        <label>
          Title, publisher or URL
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
      {sources.length === 0 ? (
        <p className="muted">No sources found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Publisher</th>
              <th scope="col">Type</th>
              <th scope="col">Tier</th>
              <th scope="col">Last checked</th>
              <th scope="col">Cited</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/sources/${s.id}`}>{s.title}</Link>
                  {s.deletedAt && <span className="muted"> (archived)</span>}
                </td>
                <td>{s.publisher}</td>
                <td>{SOURCE_TYPE_LABELS[s.sourceType]}</td>
                <td>{sourceTier(s.sourceType)}</td>
                <td>{formatDate(s.retrievedAt)}</td>
                <td>{s.citationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
