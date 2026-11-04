import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { ResultGroup } from '@civicscope/core';
import { getStateResults, listResultDates, type ResultContestView } from '@civicscope/cms';
import { AutoRefresh } from '@/components/results/auto-refresh';
import { ContestCard } from '@/components/results/contest';
import { reportingText, timeEt } from '@/components/results/format';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ state: string }> };

const GROUPS: { group: ResultGroup; title: string; open: boolean }[] = [
  { group: 'federal', title: 'Congress', open: true },
  { group: 'statewide', title: 'Statewide offices', open: true },
  { group: 'measure', title: 'Ballot measures', open: true },
  { group: 'legislature', title: 'State legislature', open: false },
  { group: 'judicial', title: 'Judges', open: false },
  { group: 'local', title: 'Local', open: false },
];

const load = cache(async (state: string) => {
  if (!/^[a-z]{2}$/i.test(state)) return null;
  const db = getDb();
  const [date] = await listResultDates(db);
  return date ? getStateResults(db, state, date) : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await load((await params).state);
  if (!page) return { title: 'Not found · CivicScope' };
  return {
    title: `${page.summary.stateName} results · CivicScope`,
    description: `Unofficial ${page.summary.stateName} results from the state’s official results file.`,
  };
}

export default async function StateResultsPage({ params }: Params) {
  const page = await load((await params).state);
  if (!page) notFound();
  const { summary: s, contests } = page;
  const byGroup = new Map<ResultGroup, ResultContestView[]>();
  for (const c of contests) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  const groups = GROUPS.filter((g) => byGroup.has(g.group));
  const base = `/results/${s.state.toLowerCase()}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/results">Results</Link> <span aria-hidden="true">/</span> {s.stateName}
      </nav>
      <section className="hero results-hero" aria-labelledby="state-title">
        <p className="eyebrow">Live · Unofficial results</p>
        <h1 id="state-title">{s.stateName}</h1>
        <p className="hero-lede">
          {formatDate(s.electionDate)} · {s.contests} contests
          {s.headline && (
            <>
              {' '}
              · {s.headline.name}: {reportingText(s.headline)}
            </>
          )}
        </p>
        <AutoRefresh />
      </section>

      <div className="results-source">
        <p>
          Source:{' '}
          <a href={s.publicUrl ?? s.sourceUrl} rel="noopener">
            {s.stateName} official results
          </a>{' '}
          (
          <a href={s.sourceUrl} rel="noopener">
            data file
          </a>
          ). Numbers last changed {timeEt(s.changedAt)}; checked {timeEt(s.fetchedAt)}.
        </p>
        {s.error && (
          <p className="notice">
            The latest check of the state’s file failed, so these numbers may be behind. We’ll keep
            trying.
          </p>
        )}
      </div>

      <nav aria-label="Contest types" className="group-nav">
        {groups.map((g) => (
          <a key={g.group} href={`#${g.group}`}>
            {g.title} <span className="count">{byGroup.get(g.group)!.length}</span>
          </a>
        ))}
      </nav>

      {groups.map((g) => {
        const list = byGroup.get(g.group)!;
        const cards = (
          <div className="contest-grid">
            {list.map((c) => (
              <ContestCard key={c.id} contest={c} areasHref={`${base}/${c.id}`} />
            ))}
          </div>
        );
        return (
          <section key={g.group} id={g.group} className="result-group" aria-label={g.title}>
            {g.open ? (
              <>
                <div className="section-heading">
                  <h2>{g.title}</h2>
                </div>
                {cards}
              </>
            ) : (
              <details>
                <summary className="section-heading">
                  <h2>
                    {g.title} <span className="count">{list.length} contests</span>
                  </h2>
                </summary>
                {cards}
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}
