import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicIssues } from '@civicscope/cms';
import { getDb } from '@/lib/db';

// Positions change as entries are published; always read the current state.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Issues · CivicScope',
  description: 'Where candidates in upcoming races stand on each issue, with sources.',
};

export default async function IssuesPage() {
  const issues = await listPublicIssues(getDb());
  return (
    <>
      <h1>Issues</h1>
      <p className="muted">
        Each issue page lists the published positions of candidates in upcoming races, grouped by
        race, with sources.
      </p>
      {issues.length === 0 ? (
        <p>No issues yet.</p>
      ) : (
        <ul className="issue-list">
          {issues.map((i) => (
            <li key={i.id}>
              <Link href={`/issues/${i.slug}`}>{i.name}</Link>{' '}
              <span className="muted">
                ·{' '}
                {i.candidates === 0
                  ? 'no positions yet'
                  : `${i.candidates} candidate${i.candidates === 1 ? '' : 's'} with a position`}
              </span>
              {i.description && <p className="muted">{i.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
