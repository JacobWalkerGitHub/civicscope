import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getContestResults } from '@civicscope/cms';
import { AutoRefresh } from '@/components/results/auto-refresh';
import { ContestCard } from '@/components/results/contest';
import { CountyExplorer } from '@/components/results/county-explorer';
import { COUNTY_MAPS } from '@/components/results/geo';
import { fmt, pct, timeEt } from '@/components/results/format';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ state: string; contest: string }> };

const load = cache(async (state: string, raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const page = await getContestResults(getDb(), id);
  return page && page.feed.state.toLowerCase() === state.toLowerCase() ? page : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await params;
  const page = await load(p.state, p.contest);
  if (!page) return { title: 'Not found · CivicScope' };
  return { title: `${page.contest.name} · ${page.stateName} results · CivicScope` };
}

export default async function ContestResultsPage({ params }: Params) {
  const p = await params;
  const page = await load(p.state, p.contest);
  if (!page) notFound();
  const { contest, feed, stateName, candidates, areas } = page;
  const stateHref = `/results/${feed.state.toLowerCase()}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/results">Results</Link> <span aria-hidden="true">/</span>{' '}
        <Link href={stateHref}>{stateName}</Link> <span aria-hidden="true">/</span> {contest.name}
      </nav>
      <AutoRefresh />
      <div className="contest-detail">
        <ContestCard contest={{ ...contest, candidates }} headingLevel={2} />
        {COUNTY_MAPS[feed.state] && areas.length > 0 && (
          <CountyExplorer
            viewBox={COUNTY_MAPS[feed.state]!.viewBox}
            shapes={COUNTY_MAPS[feed.state]!.areas}
            areas={areas}
            candidates={candidates}
          />
        )}
      </div>

      {areas.length > 0 && (
        <section aria-labelledby="by-county">
          <div className="section-heading">
            <h2 id="by-county">By county</h2>
            <span className="muted">Numbers last changed {timeEt(feed.changedAt)}</span>
          </div>
          <div className="table-scroll">
            <table className="area-table">
              <thead>
                <tr>
                  <th scope="col">County</th>
                  <th scope="col" className="num">
                    Precincts
                  </th>
                  {candidates.map((c) => (
                    <th key={c.key} scope="col" className="num">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => {
                  const total = Object.values(a.votes).reduce((n, v) => n + v, 0);
                  return (
                    <tr key={a.code}>
                      <th scope="row">{a.name}</th>
                      <td className="num">
                        {fmt(a.precinctsReporting ?? 0)}/{fmt(a.precinctsTotal ?? 0)}
                      </td>
                      {candidates.map((c) => {
                        const v = a.votes[c.key] ?? 0;
                        return (
                          <td key={c.key} className="num">
                            {fmt(v)}
                            <span className="muted"> {pct(v, total)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="muted results-note">
        Source:{' '}
        <a href={feed.publicUrl ?? feed.sourceUrl} rel="noopener">
          {stateName} official results
        </a>
        . Unofficial until certified. CivicScope does not call races.
      </p>
    </>
  );
}
