import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicIssue } from '@civicscope/cms';
import { Sources } from '@/components/public/sources';
import { getDb } from '@/lib/db';
import { CONTENT_KIND_LABELS, formatDate, POSITION_TYPE_LABELS } from '@/lib/labels';

// Positions change as entries are published; always read the current state.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) =>
  /^[a-z0-9-]{1,100}$/.test(slug) ? getPublicIssue(getDb(), slug) : null,
);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await load((await params).slug);
  if (!page) return { title: 'Not found · CivicScope' };
  return {
    title: `${page.issue.name} · Issues · CivicScope`,
    description: `Where candidates in upcoming races stand on ${page.issue.name}, with sources.`,
  };
}

export default async function IssuePage({ params }: Params) {
  const page = await load((await params).slug);
  if (!page) notFound();
  const { issue, races, citations } = page;
  return (
    <>
      <header className="profile-header">
        <h1>{issue.name}</h1>
        {issue.description && <p>{issue.description}</p>}
      </header>
      <p className="muted">
        Published positions of candidates in upcoming races, grouped by race and listed
        alphabetically by last name. A candidate who isn’t listed has no position on this issue on
        file with us. That does not mean they hold no view.
      </p>
      {races.length === 0 ? (
        <p>No positions on this issue are published for upcoming races yet.</p>
      ) : (
        races.map((r) => (
          <section key={r.raceId} aria-labelledby={`race-${r.raceId}`}>
            <h2 id={`race-${r.raceId}`}>
              <Link href={`/races/${r.raceId}`}>{r.raceName}</Link>
            </h2>
            <p className="muted">
              {r.electionName} · {formatDate(r.electionDate)} · {r.withPosition} of{' '}
              {r.candidateCount} candidate{r.candidateCount === 1 ? '' : 's'} with a position on
              file · <Link href={`/races/${r.raceId}/compare`}>Compare candidates</Link>
            </p>
            {r.rows.map((row) => (
              <article key={`${row.claimId}-${row.candidacyId}`} className="entry">
                <h3 className="h3">
                  <Link href={`/candidates/${row.personSlug}`}>{row.ballotName}</Link>{' '}
                  <span className="muted">· {row.partyName ?? 'No party listed'}</span>
                </h3>
                <p>
                  <strong>{row.title}</strong>
                </p>
                <p className="entry-meta">
                  {row.positionType && <>{POSITION_TYPE_LABELS[row.positionType]} · </>}
                  {row.statedOn && <>{formatDate(row.statedOn)} · </>}
                  {CONTENT_KIND_LABELS[row.contentKind]}
                </p>
                <p>{row.summary}</p>
                <Sources cites={citations.get(row.claimId)} />
              </article>
            ))}
          </section>
        ))
      )}
    </>
  );
}
