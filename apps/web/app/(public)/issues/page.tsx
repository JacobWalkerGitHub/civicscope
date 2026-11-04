import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicIssues } from '@civicscope/cms';
import { PageIntro } from '@/components/public/ui';
import { getDb } from '@/lib/db';

// Positions change as entries are published; always read the current state.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Issues · CivicScope',
  description: 'Where candidates in upcoming races stand on each issue, with sources.',
};

export default async function IssuesPage() {
  const issues = await listPublicIssues(getDb());
  const withPositions = issues.filter((i) => i.candidates > 0).length;
  return (
    <>
      <PageIntro eyebrow="Policy research" title="Issues">
        <p>
          Each issue page lists the published positions of candidates in upcoming races, grouped by
          race, with sources.
        </p>
      </PageIntro>
      {issues.length === 0 ? (
        <p className="notice">No issues yet.</p>
      ) : (
        <>
          {withPositions === 0 && (
            <p className="notice">
              No candidate positions are published yet. A position appears here only once it is
              published with a source, so an empty issue means we have not recorded one, not that a
              candidate has none.
            </p>
          )}
          <ul className="issue-grid">
            {issues.map((i) => (
              <li key={i.id}>
                <Link href={`/issues/${i.slug}`} className="issue-card">
                  <span className="issue-name">{i.name}</span>
                  {i.description && <span className="issue-desc">{i.description}</span>}
                  <span className={i.candidates === 0 ? 'issue-count empty' : 'issue-count'}>
                    {i.candidates === 0
                      ? 'No positions yet'
                      : `${i.candidates} candidate${i.candidates === 1 ? '' : 's'} with a position`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
