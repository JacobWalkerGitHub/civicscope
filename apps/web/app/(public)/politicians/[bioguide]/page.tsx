import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  alertsEnabled,
  getOfficeTimeline,
  getPublicMember,
  publishedPersonFor,
} from '@civicscope/cms';
import { BIOGUIDE_ID, bioguideUrl } from '@civicscope/core';
import { FollowButton } from '@/components/public/follow';
import { ElectionCards, OfficeNowNext } from '@/components/public/offices';
import { ReportLink } from '@/components/public/sources';
import { Avatar, StageBadge } from '@/components/public/ui';
import { rollCallUrl, voteDate } from '@/components/congress-format';
import { getDb } from '@/lib/db';
import { CONGRESS_CHAMBER_LABELS, formatDate, ordinal, seatLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

type Params = Promise<{ bioguide: string }>;

async function load(params: Params) {
  const id = (await params).bioguide.toUpperCase();
  if (!BIOGUIDE_ID.test(id)) return null;
  return getPublicMember(getDb(), id);
}

/** Their won races and every election, from the linked CivicScope profile, if published. */
async function loadTimeline(bioguideId: string) {
  const personId = await publishedPersonFor(getDb(), 'bioguide', bioguideId);
  return personId ? getOfficeTimeline(getDb(), personId) : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await load(params);
  if (!data) return { title: 'Not found · CivicScope' };
  return {
    title: `${data.member.name} · CivicScope`,
    description: `Bills sponsored and recorded votes of ${data.member.name}, from Congress.gov and official roll calls.`,
  };
}

const sideOf = (cast: string) => {
  const c = cast.toLowerCase();
  if (c === 'yea' || c === 'aye' || c === 'yes') return 'yes';
  if (c === 'nay' || c === 'no') return 'no';
  if (c === 'not voting') return 'absent';
  return 'present';
};

export default async function MemberPage({ params }: { params: Params }) {
  const data = await load(params);
  if (!data) notFound();
  const { member, memberships, bills, votes, sponsorCount, cosponsorCount } = data;
  const now = memberships[0]!;
  const timeline = await loadTimeline(member.bioguideId);
  const sponsored = bills.filter((b) => b.role === 'sponsor');
  const cosponsored = bills.filter((b) => b.role === 'cosponsor');

  return (
    <article>
      <p className="crumbs">
        <Link href="/politicians">Politicians</Link>
      </p>
      <header className="person-hero">
        <Avatar name={member.name} size="lg" photoId={member.photoId} />
        <div>
          <h1>{member.name}</h1>
          <p className="person-seat">
            {seatLabel(now.chamber, now.state, now.district)}
            {now.partyName && <span className="chip">{now.partyName}</span>}
          </p>
          <div className="bill-actions">
            {member.personSlug && (
              <Link className="button" href={`/candidates/${member.personSlug}`}>
                Full profile and campaigns
              </Link>
            )}
            <a
              className="button button-secondary"
              href={bioguideUrl(member.bioguideId)}
              rel="noopener"
            >
              Official biography
            </a>
            {alertsEnabled() && <FollowButton kind="member" targetKey={member.bioguideId} />}
          </div>
        </div>
      </header>

      {timeline && (
        <OfficeNowNext timeline={timeline} raceHref={(id) => `/races/${id}`} linkCurrent={false} />
      )}

      <dl className="stat-row">
        <div>
          <dt>Bills sponsored</dt>
          <dd>{sponsorCount}</dd>
        </div>
        <div>
          <dt>Bills cosponsored</dt>
          <dd>{cosponsorCount}</dd>
        </div>
        <div>
          <dt>In Congress since</dt>
          <dd>{Math.min(...memberships.map((m) => m.startYear))}</dd>
        </div>
      </dl>

      <div className="bill-layout">
        <div className="bill-main">
          {timeline && timeline.elections.length > 0 && (
            <ElectionCards elections={timeline.elections} raceHref={(id) => `/races/${id}`} />
          )}
          <section aria-labelledby="votes-h">
            <h2 id="votes-h">Recent votes</h2>
            {votes.length === 0 ? (
              <p className="muted">No recorded votes imported yet.</p>
            ) : (
              <div className="table-scroll card flush">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Question</th>
                      <th scope="col">Vote</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {votes.map((v) => (
                      <tr key={v.id}>
                        <td className="nowrap">{voteDate.format(v.votedAt)}</td>
                        <td>
                          {v.bill ? (
                            <Link
                              href={`/bills/${v.bill.congress}/${v.bill.billType}/${v.bill.number}`}
                            >
                              {v.bill.label}
                            </Link>
                          ) : (
                            v.legislationType && (
                              <span>
                                {v.legislationType} {v.legislationNumber}
                              </span>
                            )
                          )}{' '}
                          <span className="muted">{v.question}</span>{' '}
                          <a href={rollCallUrl(v) ?? v.sourceUrl} rel="noopener" className="small">
                            {CONGRESS_CHAMBER_LABELS[v.chamber]} roll call {v.rollNumber}
                          </a>
                        </td>
                        <td>
                          <span className={`vote-cast vote-${sideOf(v.voteCast)}`}>
                            {v.voteCast}
                          </span>
                        </td>
                        <td>{v.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {[
            { key: 'sponsored', title: 'Bills sponsored', list: sponsored },
            { key: 'cosponsored', title: 'Bills cosponsored', list: cosponsored },
          ].map((s) => (
            <section key={s.key} aria-labelledby={`${s.key}-h`}>
              <h2 id={`${s.key}-h`}>{s.title}</h2>
              {s.list.length === 0 ? (
                <p className="muted">None imported yet.</p>
              ) : (
                <ul className="bill-list compact">
                  {s.list.map((b) => (
                    <li key={`${b.congress}-${b.billType}-${b.number}`} className="bill-card">
                      <div className="bill-card-top">
                        <span className="bill-number">{b.label}</span>
                        <StageBadge stage={b.stage} />
                        {b.latestActionOn && (
                          <span className="muted small">{formatDate(b.latestActionOn)}</span>
                        )}
                      </div>
                      <Link
                        href={`/bills/${b.congress}/${b.billType}/${b.number}`}
                        className="bill-title-link"
                      >
                        {b.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {bills.length >= 60 && (
            <p className="small muted">
              Showing the most recent bills. Search all bills on the{' '}
              <Link href="/bills?tab=all">Bills</Link> page.
            </p>
          )}
        </div>
        <aside className="bill-side">
          <section className="card" aria-labelledby="service-h">
            <h2 id="service-h" className="h3">
              Service
            </h2>
            <ul className="compact-list">
              {memberships.map((m) => (
                <li key={`${m.congress}-${m.chamber}`}>
                  <strong>{ordinal(m.congress)} Congress</strong>
                  <br />
                  <span className="small">
                    {seatLabel(m.chamber, m.state, m.district)}
                    {m.partyName && ` · ${m.partyName}`}
                  </span>
                  <br />
                  <a className="small" href={m.sourceUrl} rel="noopener">
                    Source
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="h3">About this page</h2>
            <p className="small muted">
              Seats, sponsorships and votes come from Congress.gov, the Clerk of the House and
              senate.gov. CivicScope shows them as recorded and does not rate or score members.
            </p>
          </section>
        </aside>
      </div>
      <ReportLink path={`/politicians/${member.bioguideId}`} />
    </article>
  );
}
