import Link from 'next/link';
import type { getPublicComparison, PublicCitation } from '@civicscope/cms';
import {
  BIO_CATEGORY_LABELS,
  CANDIDACY_STATUS_LABELS,
  CONTENT_KIND_LABELS,
  formatDate,
  POSITION_TYPE_LABELS,
  VERIFICATION_LABELS,
} from '@/lib/labels';
import { rollCallUrl, voteDate, voteMeasure } from '../congress-format';
import { NotPublic, Sources, Thumb } from './sources';

type Comparison = NonNullable<Awaited<ReturnType<typeof getPublicComparison>>>;
type Column = Comparison['columns'][number];
type Entry = Column['positions'][number];

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const n = (x: number) => x.toLocaleString('en-US');
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const hasRecord = (r: Column['record']) =>
  r.seats.length > 0 || r.sponsorCount + r.cosponsorCount + r.congressVotes + r.stateVotes > 0;

/** Seats in Congress and how much of a voting and bill record is on file. */
function Record({ r }: { r: Column['record'] }) {
  if (!hasRecord(r)) return <Empty />;
  return (
    <div className="compare-record">
      {r.seats.length > 0 && (
        <ul className="compare-seats">
          {r.seats.map((s) => (
            <li key={`${s.chamber}${s.state}${s.district}`}>
              {s.chamber === 'senate'
                ? `U.S. Senate, ${s.state}`
                : `U.S. House, ${s.state}${s.district && s.district !== '0' ? ` District ${s.district}` : ' at-large'}`}
              , {s.startYear}–{s.endYear ?? 'present'}
            </li>
          ))}
        </ul>
      )}
      {(r.sponsorCount > 0 || r.cosponsorCount > 0) && (
        <p>
          Sponsored {plural(r.sponsorCount, 'bill')}, cosponsored {n(r.cosponsorCount)}
        </p>
      )}
      {r.congressVotes > 0 && <p>{plural(r.congressVotes, 'recorded vote')} in Congress</p>}
      {r.stateVotes > 0 && <p>{plural(r.stateVotes, 'recorded vote')} in a state legislature</p>}
      <p className="entry-meta">
        {r.seats.length || r.congressVotes ? 'Congress.gov, House Clerk, senate.gov' : ''}
        {(r.seats.length || r.congressVotes) && r.stateVotes ? ' · ' : ''}
        {r.stateVotes ? 'Open States' : ''}
        {r.bioguideId && (
          <>
            {' · '}
            <Link href={`/politicians/${r.bioguideId}`}>Full record</Link>
          </>
        )}
      </p>
    </div>
  );
}

/** Money raised and spent, as the campaign reported it to the FEC. */
function Money({ m }: { m: Column['money'] }) {
  if (!m) return <Empty />;
  const row = (label: string, v: number | null) => (
    <>
      <dt>{label}</dt>
      <dd>{v == null ? 'Not reported' : dollars.format(v)}</dd>
    </>
  );
  return (
    <>
      <dl className="compare-money">
        {row('Raised', m.receipts)}
        {row('Spent', m.disbursements)}
        {row('Cash on hand', m.cashOnHand)}
      </dl>
      <p className="entry-meta">
        {m.cycle - 1}–{m.cycle} cycle
        {m.coverageEnd && <>, through {formatDate(m.coverageEnd)}</>} ·{' '}
        <a
          href={`https://www.fec.gov/data/candidate/${m.candidateId}/?cycle=${m.cycle}&election_full=false`}
          rel="noopener noreferrer"
          target="_blank"
        >
          FEC filings
        </a>
      </p>
    </>
  );
}

/** Roll calls two or more of the compared candidates voted on, with each one's vote. */
function SharedVotes({ data }: { data: Comparison }) {
  const { columns, sharedVotes } = data;
  const { congress, state } = sharedVotes;
  if (!congress.length && !state.length) return null;
  const head = (
    <tr>
      <th scope="col">Date</th>
      <th scope="col">Vote on</th>
      {columns.map((c) => (
        <th key={c.candidacyId} scope="col">
          {c.ballotName}
        </th>
      ))}
      <th scope="col">Result</th>
    </tr>
  );
  const cell = (cast: Map<number, string>, c: Column) => {
    const v = cast.get(c.personId);
    return v ? (
      <td key={c.candidacyId}>{capital(v)}</td>
    ) : (
      <td key={c.candidacyId} className="muted">
        No vote on file
      </td>
    );
  };
  return (
    <section aria-labelledby="shared-votes-heading" className="compare-shared">
      <h2 id="shared-votes-heading">
        {columns.length > 2 ? 'Votes more than one of them cast' : 'Votes they both cast'}
      </h2>
      <p className="muted">
        The most recent roll calls on which at least two of these candidates have a recorded vote,
        from the chambers’ own records. Each links to the official roll call. A single vote is
        rarely the whole story: read the measure for context.
      </p>
      {congress.length > 0 && (
        <div
          className="table-wrap"
          role="region"
          aria-label="Shared votes in Congress"
          tabIndex={0}
        >
          <table className="area-table compare-votes">
            <caption>In Congress</caption>
            <thead>{head}</thead>
            <tbody>
              {congress.map((v) => {
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
                            {' · '}
                            <a href={url} rel="noopener noreferrer" target="_blank">
                              Official record
                            </a>
                          </>
                        )}
                      </span>
                    </td>
                    {columns.map((c) => cell(v.cast, c))}
                    <td>{v.result}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {state.length > 0 && (
        <div className="table-wrap" role="region" aria-label="Shared state votes" tabIndex={0}>
          <table className="area-table compare-votes">
            <caption>In the state legislature</caption>
            <thead>{head}</thead>
            <tbody>
              {state.map((v) => (
                <tr key={v.id}>
                  <td>{formatDate(v.votedOn)}</td>
                  <td>
                    <strong>
                      {v.bill.url ? (
                        <a href={v.bill.url} rel="noopener noreferrer" target="_blank">
                          {v.bill.identifier}
                        </a>
                      ) : (
                        v.bill.identifier
                      )}
                    </strong>{' '}
                    {v.bill.title}
                    <span className="muted state-vote-motion">
                      {v.bill.state}, {v.bill.session}: {v.motion}
                      {v.sourceUrl && (
                        <>
                          {' · '}
                          <a href={v.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                            Roll call
                          </a>
                        </>
                      )}
                    </span>
                  </td>
                  {columns.map((c) => cell(v.cast, c))}
                  <td>
                    {v.result === 'pass'
                      ? 'Passed'
                      : v.result === 'fail'
                        ? 'Failed'
                        : capital(v.result)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function years(c: Entry) {
  if (c.startYear && c.endYear) return `${c.startYear}–${c.endYear}`;
  if (c.startYear) return `${c.startYear}–present`;
  if (c.endYear) return `until ${c.endYear}`;
  return null;
}

/** An empty cell says so in words: no position on file is not the same as opposing. */
function Empty() {
  return <p className="muted compare-empty">Nothing on file</p>;
}

function Entries({ list, cites }: { list: Entry[]; cites: Map<number, PublicCitation[]> }) {
  if (list.length === 0) return <Empty />;
  return (
    <ul className="compare-entries">
      {list.map((c) => {
        const when = c.statedOn ? formatDate(c.statedOn) : years(c);
        return (
          <li key={c.id}>
            <strong>{c.title}</strong> <NotPublic state={c.publishState} />
            <p className="entry-meta">
              {c.positionType && <>{POSITION_TYPE_LABELS[c.positionType]} · </>}
              {c.bioCategory && <>{BIO_CATEGORY_LABELS[c.bioCategory]} · </>}
              {c.organization && <>{c.organization} · </>}
              {when && <>{when} · </>}
              {CONTENT_KIND_LABELS[c.contentKind]}
            </p>
            <p>{c.summary}</p>
            {(c.verificationStatus === 'disputed' || c.verificationStatus === 'outdated') && (
              <p className="entry-flag">
                <strong>{VERIFICATION_LABELS[c.verificationStatus]}.</strong>
              </p>
            )}
            <Sources cites={cites.get(c.id)} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Candidates in one race side by side. Each row is an issue at least one of them has a
 * published position on; every filled cell carries its sources and every empty one says
 * "Nothing on file".
 */
export function ComparisonTable({
  data,
  candidateHref,
  formAction,
}: {
  data: Comparison;
  candidateHref: (slug: string) => string;
  formAction: string;
}) {
  const { race, columns, issues, citations, candidatesInRace } = data;
  const chosen = new Set(columns.map((c) => c.candidacyId));
  return (
    <>
      <header className="profile-header">
        <h1>
          Compare candidates <NotPublic state={race.publishState} />
        </h1>
        <p>
          <Link href={`/races/${race.id}`}>{race.name}</Link> · {race.electionName} ·{' '}
          {formatDate(race.electionDate)}
        </p>
      </header>
      <p className="muted">
        Only candidates in this race can be compared. Each entry links to its sources. “Nothing on
        file” means we have not published anything on that topic for the candidate. It does not mean
        they hold no view.
      </p>

      {candidatesInRace.length > 2 && (
        <form method="get" action={formAction} className="filters" aria-label="Choose candidates">
          <fieldset className="compare-picker">
            <legend>Candidates to compare (up to 6)</legend>
            {candidatesInRace.map((c) => (
              <label key={c.candidacyId} className="inline">
                <input
                  type="checkbox"
                  name="c"
                  value={c.candidacyId}
                  defaultChecked={chosen.has(c.candidacyId)}
                />
                {c.ballotName}
              </label>
            ))}
          </fieldset>
          <button type="submit">Compare</button>
        </form>
      )}

      {columns.length === 0 ? (
        <p>No candidates are published for this race yet.</p>
      ) : (
        <div className="table-wrap" role="region" aria-label="Comparison" tabIndex={0}>
          <table className="compare">
            <caption className="visually-hidden">
              {race.name}: candidates side by side, listed alphabetically by last name
            </caption>
            <thead>
              <tr>
                <td />
                {columns.map((c) => (
                  <th key={c.candidacyId} scope="col">
                    <Thumb photoId={c.photoId} name={c.ballotName} />
                    <Link href={candidateHref(c.personSlug)}>{c.ballotName}</Link>{' '}
                    <NotPublic state={c.publishState} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">On the ballot</th>
                {columns.map((c) => (
                  <td key={c.candidacyId}>
                    {c.partyName ?? 'No party listed'}
                    {c.isIncumbent && ' · Incumbent'}
                    <br />
                    <span className="muted">
                      {c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'Status not yet recorded'}
                      {c.statusDate && <> as of {formatDate(c.statusDate)}</>}
                    </span>
                    <Sources cites={citations.candidacy.get(`candidacy:${c.candidacyId}`)} />
                  </td>
                ))}
              </tr>
              {issues.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    <Link href={`/issues/${i.slug}`}>{i.name}</Link>
                  </th>
                  {columns.map((c) => (
                    <td key={c.candidacyId}>
                      <Entries
                        list={c.positions.filter((p) => p.issueId === i.id)}
                        cites={citations.claim}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {columns.some((c) => c.positions.some((p) => !p.issueId)) && (
                <tr>
                  <th scope="row">Other positions</th>
                  {columns.map((c) => (
                    <td key={c.candidacyId}>
                      <Entries
                        list={c.positions.filter((p) => !p.issueId)}
                        cites={citations.claim}
                      />
                    </td>
                  ))}
                </tr>
              )}
              <tr>
                <th scope="row">Background</th>
                {columns.map((c) => (
                  <td key={c.candidacyId}>
                    <Entries list={c.biography} cites={citations.claim} />
                  </td>
                ))}
              </tr>
              {columns.some((c) => hasRecord(c.record)) && (
                <tr>
                  <th scope="row">Record in office</th>
                  {columns.map((c) => (
                    <td key={c.candidacyId}>
                      <Record r={c.record} />
                    </td>
                  ))}
                </tr>
              )}
              <tr>
                <th scope="row">Accomplishments</th>
                {columns.map((c) => (
                  <td key={c.candidacyId}>
                    <Entries list={c.accomplishments} cites={citations.claim} />
                  </td>
                ))}
              </tr>
              {columns.some((c) => c.money) && (
                <tr>
                  <th scope="row">Campaign money</th>
                  {columns.map((c) => (
                    <td key={c.candidacyId}>
                      <Money m={c.money} />
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <SharedVotes data={data} />
    </>
  );
}
