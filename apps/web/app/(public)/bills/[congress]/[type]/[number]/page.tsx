import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { alertsEnabled, billFollowKey, getPublicBill } from '@civicscope/cms';
import type { BillStage, BillType } from '@civicscope/core';
import { FollowButton } from '@/components/public/follow';
import { ReportLink } from '@/components/public/sources';
import { Avatar, StageBadge } from '@/components/public/ui';
import { rollCallUrl, voteDataSource, voteDate } from '@/components/congress-format';
import { getDb } from '@/lib/db';
import { CONGRESS_CHAMBER_LABELS, formatDate, ordinal } from '@/lib/labels';

export const dynamic = 'force-dynamic';

type Params = Promise<{ congress: string; type: string; number: string }>;

async function load(params: Params) {
  const p = await params;
  const congress = Number(p.congress);
  const number = Number(p.number);
  if (!Number.isInteger(congress) || !Number.isInteger(number) || number < 1) return null;
  return getPublicBill(getDb(), congress, p.type.toLowerCase(), number);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { title: 'Bill not found · CivicScope' };
  return {
    title: `${data.bill.label}: ${data.bill.title.slice(0, 80)} · CivicScope`,
    description: `Summary, sponsors and roll-call votes for ${data.bill.label} in the ${ordinal(data.bill.congress)} Congress.`,
  };
}

/** The usual path of a bill, with how far this one got. */
function progressSteps(type: BillType, stage: BillStage | null) {
  const origin = type.startsWith('h') ? 'House' : 'Senate';
  const other = origin === 'House' ? 'Senate' : 'House';
  const simple = type === 'hres' || type === 'sres';
  const concurrent = type === 'hconres' || type === 'sconres';
  const steps = simple
    ? ['Introduced', 'Committee', 'Adopted']
    : concurrent
      ? ['Introduced', 'Committee', `Passed ${origin}`, `Passed ${other}`, 'Adopted']
      : ['Introduced', 'Committee', `Passed ${origin}`, `Passed ${other}`, 'Became law'];
  const reached: Record<BillStage, number> = {
    introduced: 0,
    committee: 1,
    reported: 1,
    passed_house: origin === 'House' ? 2 : 3,
    passed_senate: origin === 'Senate' ? 2 : 3,
    passed_both: 3,
    law: 4,
    adopted: steps.length - 1,
    vetoed: 3,
    failed: -1,
  };
  return { steps, at: stage ? reached[stage] : 0 };
}

const SIDES = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['present', 'Present'],
  ['absent', 'Not voting'],
] as const;

export default async function BillPage({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  const { bill: b, sponsors, cosponsors, votes } = data;
  const path = `/bills/${b.congress}/${b.billType}/${b.number}`;
  const { steps, at } = progressSteps(b.billType, b.stage);
  const activeCosponsors = cosponsors.filter((c) => !c.withdrawnOn);

  return (
    <article className="bill-page">
      <p className="crumbs">
        <Link href="/bills">Bills</Link> <span aria-hidden="true">/</span> {ordinal(b.congress)}{' '}
        Congress
      </p>
      <header className="bill-hero">
        <div className="bill-card-top">
          <span className="bill-number">{b.label}</span>
          <StageBadge stage={b.stage} />
          {b.policyArea && <span className="chip">{b.policyArea}</span>}
        </div>
        <h1>{b.title}</h1>
        <div className="bill-actions">
          {b.textUrl && (
            <a className="button" href={b.textUrl} rel="noopener">
              Read the full text
            </a>
          )}
          <a className="button button-secondary" href={b.congressGovUrl} rel="noopener">
            View on Congress.gov
          </a>
          {alertsEnabled() && <FollowButton kind="bill" targetKey={billFollowKey(b)} />}
        </div>
        {b.textUrl && b.textVersion && (
          <p className="small muted">
            Full text: {b.textVersion}
            {b.textDate && `, ${formatDate(b.textDate)}`}. Opens on Congress.gov.
          </p>
        )}
      </header>

      {b.stage !== 'failed' && (
        <ol className="stepper" aria-label="How far this bill has gone">
          {steps.map((s, i) => (
            <li
              key={s}
              className={i < at ? 'done' : i === at ? 'current' : undefined}
              aria-current={i === at ? 'step' : undefined}
            >
              <span className="stepper-dot" aria-hidden="true" />
              {s}
            </li>
          ))}
        </ol>
      )}
      {b.stage === 'vetoed' && (
        <p className="notice">This measure passed Congress and was vetoed by the President.</p>
      )}

      <div className="bill-layout">
        <div className="bill-main">
          <section aria-labelledby="summary-h" className="card">
            <h2 id="summary-h">Summary</h2>
            {b.summary ? (
              <>
                <div className="summary-text">
                  {b.summary.split('\n\n').map((p, i) => (
                    <p key={i}>
                      {p.split('\n').map((line, j) => (
                        <span key={j}>
                          {j > 0 && <br />}
                          {line}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
                <p className="source-note">
                  Written by the Congressional Research Service, a nonpartisan office of the Library
                  of Congress
                  {b.summaryVersion && <>, for the version “{b.summaryVersion}”</>}
                  {b.summaryDate && <> ({formatDate(b.summaryDate)})</>}.{' '}
                  <a href={b.congressGovUrl} rel="noopener">
                    Source: Congress.gov
                  </a>
                </p>
              </>
            ) : (
              <p className="muted">
                No summary is available yet. The Congressional Research Service writes summaries
                after a bill is introduced; until then, read the{' '}
                {b.textUrl ? (
                  <a href={b.textUrl} rel="noopener">
                    full text
                  </a>
                ) : (
                  <a href={b.congressGovUrl} rel="noopener">
                    record on Congress.gov
                  </a>
                )}
                .
              </p>
            )}
          </section>

          <section aria-labelledby="votes-h">
            <h2 id="votes-h">Roll-call votes</h2>
            {votes.length === 0 ? (
              <p className="muted">
                No recorded roll-call votes on this bill. Many bills pass by voice vote or unanimous
                consent, which record no individual votes, and most never reach a floor vote.
              </p>
            ) : (
              <ol className="vote-list">
                {votes.map((v) => {
                  const counted = v.tally.yes + v.tally.no + v.tally.present + v.tally.absent;
                  return (
                    <li key={v.id} className="vote-card card">
                      <div className="vote-head">
                        <div>
                          <p className="eyebrow">
                            {CONGRESS_CHAMBER_LABELS[v.chamber]} roll call {v.rollNumber} ·{' '}
                            {voteDate.format(v.votedAt)}
                          </p>
                          <h3>{v.question ?? 'Recorded vote'}</h3>
                        </div>
                        {v.result && <span className="vote-result">{v.result}</span>}
                      </div>
                      <div
                        className="tally-bar"
                        role="img"
                        aria-label={SIDES.map(([k, l]) => `${l} ${v.tally[k]}`).join(', ')}
                      >
                        {SIDES.map(([k]) =>
                          v.tally[k] > 0 ? (
                            <span
                              key={k}
                              className={`tally-${k}`}
                              style={{ flexGrow: v.tally[k] / Math.max(1, counted) }}
                            />
                          ) : null,
                        )}
                      </div>
                      <dl className="tally">
                        {SIDES.map(([k, l]) => (
                          <div key={k}>
                            <dt>
                              <span className={`tally-key tally-${k}`} aria-hidden="true" /> {l}
                            </dt>
                            <dd>{v.tally[k]}</dd>
                          </div>
                        ))}
                      </dl>
                      {v.byParty.length > 0 && (
                        <div className="table-scroll">
                          <table className="party-table">
                            <caption className="visually-hidden">Votes by party</caption>
                            <thead>
                              <tr>
                                <th scope="col">Party</th>
                                {SIDES.map(([k, l]) => (
                                  <th key={k} scope="col" className="num">
                                    {l}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {v.byParty.map((p) => (
                                <tr key={p.party}>
                                  <th scope="row">{p.party}</th>
                                  {SIDES.map(([k]) => (
                                    <td key={k} className="num">
                                      {p[k]}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <details className="member-votes">
                        <summary>How each member voted ({v.positions.length})</summary>
                        <ul className="member-vote-list">
                          {v.positions.map((p) => (
                            <li key={p.bioguideId}>
                              <Link href={`/politicians/${p.bioguideId}`}>{p.name}</Link>
                              <span className="muted">
                                {[p.party, p.state].filter(Boolean).join('-')}
                              </span>
                              <span className={`vote-cast vote-${p.side}`}>{p.voteCast}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                      <p className="small">
                        <a href={rollCallUrl(v) ?? v.sourceUrl} rel="noopener">
                          Official record of this vote
                        </a>
                        {voteDataSource(v) && (
                          <>
                            {' '}
                            · Data from{' '}
                            <a href={voteDataSource(v)!.url} rel="noopener">
                              {voteDataSource(v)!.name}
                            </a>
                          </>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="bill-side">
          <section aria-labelledby="facts-h" className="card">
            <h2 id="facts-h" className="h3">
              At a glance
            </h2>
            <dl className="side-facts">
              <div>
                <dt>Congress</dt>
                <dd>{ordinal(b.congress)}</dd>
              </div>
              {b.introducedOn && (
                <div>
                  <dt>Introduced</dt>
                  <dd>{formatDate(b.introducedOn)}</dd>
                </div>
              )}
              {b.latestActionText && (
                <div>
                  <dt>Latest action</dt>
                  <dd>
                    {b.latestActionOn && <strong>{formatDate(b.latestActionOn)}: </strong>}
                    {b.latestActionText}
                  </dd>
                </div>
              )}
              <div>
                <dt>Recorded votes</dt>
                <dd>{votes.length}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="sponsor-h" className="card">
            <h2 id="sponsor-h" className="h3">
              {sponsors.length === 1 ? 'Sponsor' : 'Sponsors'}
            </h2>
            {sponsors.length === 0 ? (
              <p className="muted">No sponsor listed.</p>
            ) : (
              <ul className="people-list">
                {sponsors.map((s) => (
                  <li key={s.bioguideId}>
                    <Avatar name={s.name} size="sm" photoId={s.photoId} />
                    <div>
                      <Link href={`/politicians/${s.bioguideId}`}>{s.name}</Link>
                      <span className="muted small">
                        {[s.party, s.state].filter(Boolean).join('-')}
                        {s.on && ` · ${formatDate(s.on)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="side-sub">
              Cosponsors <span className="muted">({activeCosponsors.length})</span>
            </h3>
            {cosponsors.length === 0 ? (
              <p className="muted small">None.</p>
            ) : cosponsors.length <= 8 ? (
              <ul className="compact-list">
                {cosponsors.map((c) => (
                  <li key={c.bioguideId}>
                    <Link href={`/politicians/${c.bioguideId}`}>{c.name}</Link>{' '}
                    <span className="muted small">
                      {[c.party, c.state].filter(Boolean).join('-')}
                      {c.isOriginal && ' · original'}
                      {c.withdrawnOn && ` · withdrew ${formatDate(c.withdrawnOn)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <details className="cosponsors">
                <summary>Show all {cosponsors.length}</summary>
                <ul className="compact-list">
                  {cosponsors.map((c) => (
                    <li key={c.bioguideId}>
                      <Link href={`/politicians/${c.bioguideId}`}>{c.name}</Link>{' '}
                      <span className="muted small">
                        {[c.party, c.state].filter(Boolean).join('-')}
                        {c.isOriginal && ' · original'}
                        {c.withdrawnOn && ` · withdrew ${formatDate(c.withdrawnOn)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="card source-card">
            <h2 className="h3">Source</h2>
            <p className="small">
              <a href={b.sourceUrl} rel="noopener">
                {b.label} on Congress.gov
              </a>
              <br />
              <span className="muted">
                Last checked{' '}
                {formatDate((b.sourceCheckedAt ?? b.updatedAt).toISOString().slice(0, 10))}
              </span>
            </p>
            <p className="small muted">
              The status label is CivicScope’s reading of the latest action above.
            </p>
          </section>
        </aside>
      </div>
      <ReportLink path={path} />
    </article>
  );
}
