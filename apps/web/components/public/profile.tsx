import Link from 'next/link';
import type { getPublicPerson } from '@civicscope/cms';
import { CLAIM_KINDS, type ClaimKind } from '@civicscope/core';
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
import { initials, NotPublic, ReportLink, Sources } from './sources';

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

  return (
    <>
      <header className="profile-header">
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
        {person.preferredName && <p>Goes by {person.preferredName}</p>}
        {person.birthYear && <p>Born {person.birthYear}</p>}
        <Sources
          cites={profile.citations.get(`person:${person.id}`)}
          label="Sources for these details"
        />
      </header>

      <section aria-labelledby="running-heading">
        <h2 id="running-heading">Candidacies</h2>
        {candidacies.length === 0 ? (
          <p className="muted">No current candidacies are published.</p>
        ) : (
          <ul className="candidacies">
            {candidacies.map((c) => (
              <li key={c.id}>
                <h3>
                  <Link href={raceHref(c.raceId)}>{c.raceName}</Link>{' '}
                  <NotPublic state={c.publishState} />
                </h3>
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

const CHAMBER: Record<string, { upper: string; lower: string }> = {
  NJ: { upper: 'Senate', lower: 'Assembly' },
  VA: { upper: 'Senate', lower: 'House of Delegates' },
};
const chamberName = (state: string, c: 'upper' | 'lower' | 'legislature') =>
  c === 'legislature' ? 'Legislature' : (CHAMBER[state] ?? { upper: 'Senate', lower: 'House' })[c];
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
