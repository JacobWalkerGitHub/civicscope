import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getOfficeTimeline,
  getStateOfficial,
  getStateVotesFor,
  publishedPersonFor,
} from '@civicscope/cms';
import { ElectionCards, OfficeNowNext } from '@/components/public/offices';
import { ReportLink } from '@/components/public/sources';
import { Avatar } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { formatDate, stateChamberName, stateSeatLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function load(params: Params) {
  const id = (await params).id.toLowerCase();
  if (!UUID.test(id)) return null;
  return getStateOfficial(getDb(), `ocd-person/${id}`);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { title: 'Not found · CivicScope' };
  const now = data.offices[0]!;
  return {
    title: `${now.name} · CivicScope`,
    description: `${now.name}, ${stateSeatLabel(now.role, now.state, now.district)}, from Open States’ records of official state sites.`,
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RESULTS: Record<string, string> = { pass: 'Passed', fail: 'Failed' };

export default async function StateOfficialPage({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  const { offices, personSlug } = data;
  const now = offices[0]!;
  const current = offices.filter((o) => !o.leftOn);
  const votes = await getStateVotesFor(getDb(), [now.osPersonId], 20);
  const personId = await publishedPersonFor(getDb(), 'openstates', now.osPersonId);
  const timeline = personId ? await getOfficeTimeline(getDb(), personId) : null;
  const slug = now.osPersonId.replace(/^ocd-person\//, '');

  return (
    <article>
      <p className="crumbs">
        <Link href="/politicians">Politicians</Link> ›{' '}
        <Link href={`/politicians/state?state=${now.state}`}>State officials</Link>
      </p>
      <header className="person-hero">
        <Avatar name={now.name} size="lg" photoId={data.photoId} />
        <div>
          <h1>{now.name}</h1>
          <p className="person-seat">
            {stateSeatLabel(now.role, now.state, now.district)}
            {now.partyName && <span className="chip">{now.partyName}</span>}
          </p>
          {current.length === 0 && (
            <p className="notice">
              No longer listed in this office by Open States since {formatDate(now.leftOn!)}.
            </p>
          )}
          <div className="bill-actions">
            {personSlug && (
              <Link className="button" href={`/candidates/${personSlug}`}>
                Full profile and campaigns
              </Link>
            )}
            {now.officialUrl && (
              <a className="button button-secondary" href={now.officialUrl} rel="noopener">
                Official page
              </a>
            )}
          </div>
        </div>
      </header>

      {timeline && (
        <OfficeNowNext timeline={timeline} raceHref={(id) => `/races/${id}`} linkCurrent={false} />
      )}

      <div className="bill-layout">
        <div className="bill-main">
          {timeline && timeline.elections.length > 0 && (
            <ElectionCards elections={timeline.elections} raceHref={(id) => `/races/${id}`} />
          )}
          {now.role !== 'governor' && (
            <section aria-labelledby="votes-h">
              <h2 id="votes-h">Recent votes</h2>
              {votes.total === 0 ? (
                <p className="muted">
                  No recorded votes imported. CivicScope reads state roll calls for a few states
                  only so far; this is not a sign that they have not voted.
                </p>
              ) : (
                <>
                  <p className="muted">
                    {votes.total > votes.votes.length
                      ? `The ${votes.votes.length} most recent of ${votes.total.toLocaleString('en-US')} recorded votes`
                      : `${votes.total} recorded ${votes.total === 1 ? 'vote' : 'votes'}`}
                    , from the legislature’s own roll calls as collected by Open States.
                  </p>
                  <div className="table-scroll card flush">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Bill and motion</th>
                          <th scope="col">Vote</th>
                          <th scope="col">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {votes.votes.map((v) => (
                          <tr key={v.voteId}>
                            <td className="nowrap">{formatDate(v.votedOn)}</td>
                            <td>
                              <strong>
                                {v.bill.openstatesUrl ? (
                                  <a href={v.bill.openstatesUrl} rel="noopener">
                                    {v.bill.identifier}
                                  </a>
                                ) : (
                                  v.bill.identifier
                                )}
                              </strong>{' '}
                              {v.bill.title}{' '}
                              <span className="muted small">
                                {stateChamberName(v.bill.state, v.chamber)}, {v.bill.session}:{' '}
                                {v.motion}
                                {v.sourceUrl && (
                                  <>
                                    {' '}
                                    ·{' '}
                                    <a href={v.sourceUrl} rel="noopener nofollow">
                                      Roll call
                                    </a>
                                  </>
                                )}
                              </span>
                            </td>
                            <td>{capital(v.option)}</td>
                            <td>
                              {RESULTS[v.result] ?? capital(v.result)}{' '}
                              <span className="muted">
                                ({v.yes}–{v.no}
                                {v.other ? `, ${v.other} other` : ''})
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
          <section aria-labelledby="positions-h">
            <h2 id="positions-h">Positions and record</h2>
            <p className="muted">
              {personSlug ? (
                <>
                  Their reviewed positions, statements and sources are on their{' '}
                  <Link href={`/candidates/${personSlug}`}>full profile</Link>.
                </>
              ) : (
                <>
                  CivicScope has not reviewed this person’s positions or record yet, so none are
                  shown. We do not infer positions from party.
                </>
              )}
            </p>
          </section>
        </div>
        <aside className="bill-side">
          <section className="card" aria-labelledby="service-h">
            <h2 id="service-h" className="h3">
              Offices
            </h2>
            <ul className="compact-list">
              {offices.map((o) => (
                <li key={o.id}>
                  <strong>{stateSeatLabel(o.role, o.state, o.district)}</strong>
                  <br />
                  <span className="small">
                    {o.partyName ?? 'Party not listed'}
                    {o.termStart && <> · Term {formatDate(o.termStart)}</>}
                    {o.termEnd && <> to {formatDate(o.termEnd)}</>}
                  </span>
                  <br />
                  <span className="small muted">
                    {o.leftOn
                      ? `Listed until ${formatDate(o.leftOn)}`
                      : `Verified ${formatDate(o.lastSeenOn)}`}
                  </span>
                  <br />
                  <a className="small" href={o.sourceUrl} rel="noopener">
                    Source
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="h3">About this page</h2>
            <p className="small muted">
              Office, district and party come from{' '}
              <a href="https://openstates.org/" rel="noopener">
                Open States
              </a>
              , which collects them from official state sites. “Verified” is the last day CivicScope
              found this person listed there. CivicScope does not rate or score officeholders.
            </p>
          </section>
        </aside>
      </div>
      <ReportLink path={`/politicians/state/${slug}`} />
    </article>
  );
}
