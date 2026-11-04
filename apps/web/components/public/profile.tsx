import Link from 'next/link';
import type { getPublicPerson } from '@civicscope/cms';
import { billLabel, CLAIM_KINDS, type ClaimKind } from '@civicscope/core';
import {
  BIO_CATEGORY_LABELS,
  CANDIDACY_STATUS_LABELS,
  CLAIM_KIND_PLURALS,
  CONTENT_KIND_LABELS,
  ELECTION_TYPE_LABELS,
  formatDate,
  POSITION_TYPE_LABELS,
  VERIFICATION_LABELS,
} from '@/lib/labels';
import { rollCallUrl, voteDataSource, voteDate, voteMeasure } from '../congress-format';
import { Chip, StatusBadge, statusTone, WhenChip } from './badges';
import { initials, NotPublic, ReportLink, Sources } from './sources';
import { stateChamberName as chamberName } from '@/lib/labels';

type Profile = NonNullable<Awaited<ReturnType<typeof getPublicPerson>>>;
type Claim = Profile['claims'][number];

function years(c: Claim) {
  if (c.startYear && c.endYear) return `${c.startYear}–${c.endYear}`;
  if (c.startYear) return `${c.startYear}–present`;
  if (c.endYear) return `until ${c.endYear}`;
  return null;
}

function Entry({ c, profile }: { c: Claim; profile: Profile }) {
  const when = c.statedOn ? formatDate(c.statedOn) : years(c);
  return (
    <article className="entry" aria-labelledby={`entry-${c.id}`}>
      <h4 id={`entry-${c.id}`}>
        {c.title} <NotPublic state={c.publishState} />
      </h4>
      <p className="entry-meta">
        {c.positionType && <>{POSITION_TYPE_LABELS[c.positionType]} · </>}
        {c.bioCategory && <>{BIO_CATEGORY_LABELS[c.bioCategory]} · </>}
        {c.organization && <>{c.organization} · </>}
        {when && <>{when} · </>}
        {c.venue && <>{c.venue} · </>}
        {CONTENT_KIND_LABELS[c.contentKind]}
      </p>
      <p>{c.summary}</p>
      {c.quote && (
        <blockquote>
          <p>“{c.quote}”</p>
        </blockquote>
      )}
      {(c.verificationStatus === 'disputed' || c.verificationStatus === 'outdated') && (
        <p className="entry-flag">
          <strong>{VERIFICATION_LABELS[c.verificationStatus]}.</strong>{' '}
          {c.verificationStatus === 'disputed'
            ? 'Sources disagree about this entry. Check the sources below.'
            : 'This may no longer reflect the candidate’s current view or record.'}
        </p>
      )}
      <Sources cites={profile.citations.get(`claim:${c.id}`)} />
    </article>
  );
}

/** A candidate's public profile. Rendered for the public and, with drafts, for admin previews. */
export function CandidateProfile({
  profile,
  raceHref,
}: {
  profile: Profile;
  raceHref: (raceId: number) => string;
}) {
  const { person, candidacies, claims } = profile;
  const byKind = new Map<ClaimKind, Claim[]>();
  for (const c of claims) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const positionsByIssue = new Map<string, Claim[]>();
  for (const c of byKind.get('position') ?? []) {
    const key = c.issueName ?? 'Other';
    positionsByIssue.set(key, [...(positionsByIssue.get(key) ?? []), c]);
  }

  // The newest candidacy (the list is newest election first) leads the header.
  const current = candidacies[0];
  const sections: [string, string][] = [
    ['running-heading', 'Candidacies'],
    ...CLAIM_KINDS.filter((k) => byKind.get(k)?.length).map(
      (k) => [`${k}-heading`, CLAIM_KIND_PLURALS[k]] as [string, string],
    ),
    ...(profile.money.length ? [['money-heading', 'Campaign money'] as [string, string]] : []),
    ...(profile.congress?.votes.length || profile.congress?.memberships.length
      ? [['congress-heading', 'Record in Congress'] as [string, string]]
      : []),
    ...(profile.stateVotes.total
      ? [['state-votes-heading', 'State votes'] as [string, string]]
      : []),
  ];
  return (
    <>
      <header className="profile-header profile-hero">
        {person.photoId && (
          <figure className="profile-photo">
            <img src={`/photos/${person.photoId}`} alt={`Photo of ${person.fullName}`} />
            <figcaption>
              Photo:{' '}
              {person.photoSourceUrl ? (
                <a href={person.photoSourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                  {person.photoCredit}
                </a>
              ) : (
                person.photoCredit
              )}
            </figcaption>
          </figure>
        )}
        {!person.photoId && (
          <span className="profile-avatar" aria-hidden="true">
            {initials(person.fullName)}
          </span>
        )}
        <h1>
          {person.fullName} <NotPublic state={person.publishState} />
        </h1>
        {current && (
          <p className="badge-row">
            <StatusBadge status={current.status} date={current.statusDate} />
            <Chip>
              <Link href={raceHref(current.raceId)}>{current.raceName}</Link>
            </Chip>
            {current.isIncumbent && <Chip>Incumbent</Chip>}
            <Chip>{current.partyName ?? 'No party listed'}</Chip>
            <WhenChip date={current.electionDate} />
          </p>
        )}
        {person.preferredName && <p>Goes by {person.preferredName}</p>}
        {person.birthYear && <p>Born {person.birthYear}</p>}
        <Sources
          cites={profile.citations.get(`person:${person.id}`)}
          label="Sources for these details"
        />
        {sections.length > 2 && (
          <nav className="on-this-page" aria-label="On this page">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <section aria-labelledby="running-heading">
        <h2 id="running-heading">Candidacies</h2>
        {candidacies.length === 0 ? (
          <p className="muted">No current candidacies are published.</p>
        ) : (
          <ul className="candidacies">
            {candidacies.map((c) => (
              <li key={c.id} className={`card-${statusTone(c.status)}`}>
                <h3>
                  <Link href={raceHref(c.raceId)}>{c.raceName}</Link>{' '}
                  <NotPublic state={c.publishState} />
                </h3>
                <p className="badge-row">
                  <StatusBadge status={c.status} date={c.statusDate} />
                  {c.isIncumbent && <Chip>Incumbent</Chip>}
                  <WhenChip date={c.electionDate} />
                </p>
                <p className="muted">
                  {c.electionName} · {ELECTION_TYPE_LABELS[c.electionType]} ·{' '}
                  {formatDate(c.electionDate)}
                </p>
                <dl className="facts">
                  <dt>Name on the ballot</dt>
                  <dd>{c.ballotName}</dd>
                  <dt>Party on the ballot</dt>
                  <dd>{c.partyName ?? 'None listed'}</dd>
                  <dt>Status</dt>
                  <dd>
                    {c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'Not yet recorded'}
                    {c.statusDate && <> as of {formatDate(c.statusDate)}</>}
                  </dd>
                  {c.isIncumbent && (
                    <>
                      <dt>Incumbent</dt>
                      <dd>Currently holds this seat</dd>
                    </>
                  )}
                  {c.campaignUrl && (
                    <>
                      <dt>Campaign website</dt>
                      <dd>
                        <a href={c.campaignUrl} rel="noopener noreferrer nofollow" target="_blank">
                          {c.campaignUrl.replace(/^https:\/\//, '')}
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
                <Sources cites={profile.citations.get(`candidacy:${c.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {CLAIM_KINDS.map((kind) => {
        const entries = byKind.get(kind);
        if (!entries?.length) return null;
        return (
          <section key={kind} aria-labelledby={`${kind}-heading`}>
            <h2 id={`${kind}-heading`}>{CLAIM_KIND_PLURALS[kind]}</h2>
            {kind === 'position'
              ? [...positionsByIssue].map(([issueName, list]) => (
                  <div key={issueName} className="issue-group">
                    <h3>{issueName}</h3>
                    {list.map((c) => (
                      <Entry key={c.id} c={c} profile={profile} />
                    ))}
                  </div>
                ))
              : entries.map((c) => <Entry key={c.id} c={c} profile={profile} />)}
          </section>
        );
      })}

      {profile.money.length > 0 && <CampaignMoney totals={profile.money} />}

      {profile.congress && <CongressRecord record={profile.congress} />}

      {profile.stateVotes.total > 0 && <StateVotes record={profile.stateVotes} />}

      {claims.length === 0 && (
        <p className="muted">
          No positions or biography entries are published for this candidate yet.
        </p>
      )}

      <p className="muted about-entries">
        Entries are neutral summaries, each checked against its sources by a reviewer. Read the
        sources for full context. Last updated{' '}
        {formatDate(person.updatedAt.toISOString().slice(0, 10))}.
      </p>
      <ReportLink path={`/candidates/${person.slug}`} />
    </>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RESULTS: Record<string, string> = { pass: 'Passed', fail: 'Failed' };

/** Recent roll calls from the state legislature, as Open States recorded them. */
function StateVotes({ record }: { record: Profile['stateVotes'] }) {
  return (
    <section aria-labelledby="state-votes-heading">
      <h2 id="state-votes-heading">State legislative votes</h2>
      <p className="muted">
        {record.total > record.votes.length
          ? `The ${record.votes.length} most recent of ${record.total.toLocaleString('en-US')} recorded votes`
          : `${record.total} recorded ${record.total === 1 ? 'vote' : 'votes'}`}
        , from each legislature’s own roll calls as collected by{' '}
        <a href="https://openstates.org/" rel="noopener noreferrer" target="_blank">
          Open States
        </a>
        .
      </p>
      <div className="table-scroll">
        <table className="area-table state-votes">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Bill and motion</th>
              <th scope="col">Vote</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {record.votes.map((v) => (
              <tr key={v.voteId}>
                <td>{formatDate(v.votedOn)}</td>
                <td>
                  <strong>
                    {v.bill.openstatesUrl ? (
                      <a href={v.bill.openstatesUrl} rel="noopener noreferrer" target="_blank">
                        {v.bill.identifier}
                      </a>
                    ) : (
                      v.bill.identifier
                    )}
                  </strong>{' '}
                  {v.bill.title}
                  <span className="muted state-vote-motion">
                    {chamberName(v.bill.state, v.chamber)}, {v.bill.session}: {v.motion}
                    {v.sourceUrl && (
                      <>
                        {' '}
                        ·{' '}
                        <a href={v.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
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
    </section>
  );
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Seats, bills and recent roll calls in Congress, from the chambers' own records. */
function CongressRecord({ record }: { record: NonNullable<Profile['congress']> }) {
  const { memberships, bills, votes } = record;
  if (!memberships.length && !bills.length && !votes.length) return null;
  return (
    <section aria-labelledby="congress-heading">
      <h2 id="congress-heading">Record in Congress</h2>
      <p className="muted">
        From Congress.gov, the House Clerk and senate.gov. Each vote links to the chamber’s own roll
        call.
        {record.bioguideIds[0] && (
          <>
            {' '}
            <Link href={`/politicians/${record.bioguideIds[0]}`}>See every bill and vote →</Link>
          </>
        )}
      </p>
      {memberships.length > 0 && (
        <>
          <h3>Seats</h3>
          <ul className="congress-seats">
            {memberships.map((m) => (
              <li key={m.id}>
                {ordinal(m.congress)} Congress ({m.startYear}–{m.endYear ?? 'present'}):{' '}
                {m.chamber === 'senate'
                  ? `Senate, ${m.state}`
                  : `House, ${m.state}${m.district ? ` District ${m.district}` : ' at-large'}`}
                {m.partyName && ` · ${m.partyName}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {bills.length > 0 && (
        <>
          <h3>Bills</h3>
          <p className="muted">
            Sponsored {record.sponsorCount.toLocaleString('en-US')}, cosponsored{' '}
            {record.cosponsorCount.toLocaleString('en-US')}. The most recent:
          </p>
          <ul className="congress-bills">
            {bills.slice(0, 10).map((b) => (
              <li key={b.id}>
                <Link href={`/bills/${b.congress}/${b.billType}/${b.number}`}>
                  {billLabel(b.billType, b.number)}
                </Link>{' '}
                {b.title}{' '}
                <span className="muted">
                  · {b.role === 'sponsor' ? 'Sponsor' : 'Cosponsor'}
                  {b.sponsoredOn && `, ${formatDate(b.sponsoredOn)}`}
                  {b.withdrawnOn && ` (withdrew ${formatDate(b.withdrawnOn)})`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {votes.length > 0 && (
        <>
          <h3>Recent votes</h3>
          <p className="muted">
            {record.voteCount > votes.length
              ? `The ${votes.length} most recent of ${record.voteCount.toLocaleString('en-US')} recorded votes.`
              : `${record.voteCount} recorded ${record.voteCount === 1 ? 'vote' : 'votes'}.`}
          </p>
          <div className="table-scroll">
            <table className="area-table state-votes">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Question</th>
                  <th scope="col">Vote</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {votes.map((v) => {
                  const measure = voteMeasure(v);
                  const url = rollCallUrl(v);
                  return (
                    <tr key={v.id}>
                      <td>{voteDate.format(v.votedAt)}</td>
                      <td>
                        {measure && <strong>{measure}</strong>} {v.question}
                        <span className="muted state-vote-motion">
                          {v.chamber === 'senate' ? 'Senate' : 'House'} roll call {v.rollNumber}
                          {url && (
                            <>
                              {' '}
                              ·{' '}
                              <a href={url} rel="noopener noreferrer" target="_blank">
                                Official record
                              </a>
                            </>
                          )}
                          {voteDataSource(v) && (
                            <>
                              {' '}
                              · data from{' '}
                              <a
                                href={voteDataSource(v)!.url}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                {voteDataSource(v)!.name}
                              </a>
                            </>
                          )}
                        </span>
                      </td>
                      <td>{v.voteCast}</td>
                      <td>{v.result}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const CAMPAIGN_KIND: Record<string, string> = {
  H: 'House campaign',
  S: 'Senate campaign',
  P: 'Presidential campaign',
};

/** Money raised and spent, as the campaign reported it to the FEC. */
function CampaignMoney({ totals }: { totals: Profile['money'] }) {
  return (
    <section aria-labelledby="money-heading">
      <h2 id="money-heading">Campaign money</h2>
      <p className="muted">
        Totals the Federal Election Commission compiles from the reports the candidate’s own
        campaign committees file, and, separately, what outside groups reported spending to support
        or oppose the candidate.
      </p>
      {totals.map((t) => (
        <div key={t.candidateId} className="money-block">
          <h3>
            {CAMPAIGN_KIND[t.candidateId[0]!] ?? 'Campaign'}, {t.cycle - 1}–{t.cycle}
          </h3>
          <dl className="money-facts">
            <div>
              <dt>Raised</dt>
              <dd>{t.receipts == null ? '—' : dollars.format(t.receipts)}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>{t.disbursements == null ? '—' : dollars.format(t.disbursements)}</dd>
            </div>
            <div>
              <dt>Cash on hand</dt>
              <dd>{t.cashOnHand == null ? '—' : dollars.format(t.cashOnHand)}</dd>
            </div>
            <div>
              <dt>Debts</dt>
              <dd>{t.debts == null ? '—' : dollars.format(t.debts)}</dd>
            </div>
          </dl>
          {(t.outside.support > 0 || t.outside.oppose > 0) && <OutsideSpending t={t} />}
          <p className="muted">
            {t.coverageEnd ? `Through ${formatDate(t.coverageEnd)}. ` : ''}
            <a
              href={`https://www.fec.gov/data/candidate/${t.candidateId}/?cycle=${t.cycle}&election_full=false`}
              rel="noopener noreferrer"
              target="_blank"
            >
              Filings on FEC.gov
            </a>{' '}
            (candidate ID {t.candidateId})
          </p>
        </div>
      ))}
    </section>
  );
}

/** Independent expenditures: groups outside the campaign, for and against. */
function OutsideSpending({ t }: { t: Profile['money'][number] }) {
  const side = (label: string, total: number, list: typeof t.outside.topSupport) => (
    <div>
      <h4>
        {label}: {dollars.format(total)}
      </h4>
      {list.length > 0 ? (
        <ol className="outside-list">
          {list.map((x) => (
            <li key={x.committeeId}>
              {x.committeeName} <span className="muted">{dollars.format(x.total)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">None reported.</p>
      )}
    </div>
  );
  return (
    <div className="outside-spending">
      <h4 className="outside-heading">Outside groups</h4>
      <div className="outside-sides">
        {side('Spent supporting', t.outside.support, t.outside.topSupport)}
        {side('Spent opposing', t.outside.oppose, t.outside.topOppose)}
      </div>
    </div>
  );
}
