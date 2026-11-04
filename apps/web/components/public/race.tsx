import Link from 'next/link';
import type { getPublicRace } from '@civicscope/cms';
import {
  CANDIDACY_STATUS_LABELS,
  ELECTION_TYPE_LABELS,
  formatDate,
  PRIMARY_SYSTEM_EXPLANATIONS,
  PRIMARY_SYSTEM_LABELS,
} from '@/lib/labels';
import { NotPublic, ReportLink, Sources, Thumb } from './sources';

type RacePage = NonNullable<Awaited<ReturnType<typeof getPublicRace>>>;

/** A race's public overview: the contest, how it works and who is running. */
export function RaceOverview({
  page,
  candidateHref,
  electionHref,
  compareHref,
}: {
  page: RacePage;
  candidateHref: (slug: string) => string;
  /** Link to the election's page with its dates; omitted where there is none (preview). */
  electionHref?: (id: number) => string;
  /** Link to the side-by-side comparison; omitted in previews. */
  compareHref?: (raceId: number) => string;
}) {
  const { race, candidates } = page;
  return (
    <>
      <header className="profile-header">
        <h1>
          {race.name} <NotPublic state={race.publishState} />
        </h1>
        <p>
          {electionHref ? (
            <Link href={electionHref(race.electionId)}>{race.electionName}</Link>
          ) : (
            race.electionName
          )}{' '}
          · {formatDate(race.electionDate)}
        </p>
      </header>
      <dl className="facts">
        <dt>Office</dt>
        <dd>
          {race.officeTitle}
          {race.districtName && <>, {race.districtName}</>}
        </dd>
        <dt>Where</dt>
        <dd>{race.jurisdictionName}</dd>
        <dt>Election</dt>
        <dd>
          {ELECTION_TYPE_LABELS[race.electionType]}
          {race.isSpecial && ' (special election)'}
        </dd>
        {race.primarySystem !== 'not_applicable' && (
          <>
            <dt>Primary type</dt>
            <dd>
              {PRIMARY_SYSTEM_LABELS[race.primarySystem]}.{' '}
              {PRIMARY_SYSTEM_EXPLANATIONS[race.primarySystem]}
            </dd>
          </>
        )}
        {race.primaryPartyName && (
          <>
            <dt>Party</dt>
            <dd>This is the {race.primaryPartyName} primary.</dd>
          </>
        )}
        {race.seats > 1 && (
          <>
            <dt>Seats</dt>
            <dd>Voters choose {race.seats}.</dd>
          </>
        )}
        {race.electionUrl && (
          <>
            <dt>Official source</dt>
            <dd>
              <a href={race.electionUrl} rel="noopener noreferrer" target="_blank">
                {new URL(race.electionUrl).hostname}
              </a>
            </dd>
          </>
        )}
      </dl>

      <section aria-labelledby="candidates-heading">
        <h2 id="candidates-heading">Candidates</h2>
        {candidates.length === 0 ? (
          <p className="muted">No candidates are published for this race yet.</p>
        ) : (
          <>
            <p className="muted">
              Listed alphabetically by last name.
              {compareHref && candidates.length > 1 && (
                <>
                  {' '}
                  <Link href={compareHref(race.id)}>Compare these candidates side by side</Link>
                </>
              )}
            </p>
            <ul className="candidate-list">
              {candidates.map((c) => (
                <li key={c.candidacyId} className="with-thumb">
                  <Thumb photoId={c.photoId} name={c.ballotName} />
                  <h3>
                    <Link href={candidateHref(c.personSlug)}>{c.ballotName}</Link>{' '}
                    <NotPublic state={c.publishState} />
                  </h3>
                  <p>
                    {c.partyName ?? 'No party listed'}
                    {c.isIncumbent && ' · Incumbent'} ·{' '}
                    {c.status ? CANDIDACY_STATUS_LABELS[c.status] : 'Status not yet recorded'}
                    {c.statusDate && <> as of {formatDate(c.statusDate)}</>}
                  </p>
                  <Sources cites={page.citations.get(`candidacy:${c.candidacyId}`)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {page.money.size > 0 && <RaceMoney page={page} candidateHref={candidateHref} />}
      <ReportLink path={`/races/${race.id}`} />
    </>
  );
}

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usd = (n: number | null) => (n == null ? '—' : dollars.format(n));

/** Campaign money side by side, for the candidates the FEC reports on. */
function RaceMoney({
  page,
  candidateHref,
}: {
  page: RacePage;
  candidateHref: (slug: string) => string;
}) {
  const rows = page.candidates.filter((c) => page.money.has(c.candidacyId));
  return (
    <section aria-labelledby="money-heading">
      <h2 id="money-heading">Campaign money</h2>
      <p className="muted">
        From reports filed with the Federal Election Commission: what each campaign raised and
        spent, and what outside groups reported spending for or against each candidate. Each
        candidate’s page links to the filings.
      </p>
      <div className="table-scroll">
        <table className="area-table money-table">
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col" className="num">
                Raised
              </th>
              <th scope="col" className="num">
                Spent
              </th>
              <th scope="col" className="num">
                Cash on hand
              </th>
              <th scope="col" className="num">
                Outside, supporting
              </th>
              <th scope="col" className="num">
                Outside, opposing
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const m = page.money.get(c.candidacyId)!;
              return (
                <tr key={c.candidacyId}>
                  <th scope="row">
                    <Link href={candidateHref(c.personSlug)}>{c.ballotName}</Link>
                    <span className="muted state-vote-motion">
                      {m.cycle - 1}–{m.cycle}
                      {m.coverageEnd && `, through ${formatDate(m.coverageEnd)}`}
                    </span>
                  </th>
                  <td className="num">{usd(m.receipts)}</td>
                  <td className="num">{usd(m.disbursements)}</td>
                  <td className="num">{usd(m.cashOnHand)}</td>
                  <td className="num">{usd(m.outside.support)}</td>
                  <td className="num">{usd(m.outside.oppose)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
