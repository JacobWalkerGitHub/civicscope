import Link from 'next/link';
import type { getPublicRace } from '@civicscope/cms';
import {
  CANDIDACY_STATUS_LABELS,
  ELECTION_TYPE_LABELS,
  formatDate,
  PRIMARY_SYSTEM_LABELS,
} from '@/lib/labels';
import { NotPublic, Sources } from './sources';

type RacePage = NonNullable<Awaited<ReturnType<typeof getPublicRace>>>;

/** A race's public overview: the contest, how it works and who is running. */
export function RaceOverview({
  page,
  candidateHref,
}: {
  page: RacePage;
  candidateHref: (slug: string) => string;
}) {
  const { race, candidates } = page;
  return (
    <>
      <header className="profile-header">
        <h1>
          {race.name} <NotPublic state={race.publishState} />
        </h1>
        <p>
          {race.electionName} · {formatDate(race.electionDate)}
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
            <dd>{PRIMARY_SYSTEM_LABELS[race.primarySystem]}</dd>
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
            <dt>Official information</dt>
            <dd>
              <a href={race.electionUrl} rel="noopener noreferrer" target="_blank">
                Election office page
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
            <p className="muted">Listed alphabetically by last name.</p>
            <ul className="candidate-list">
              {candidates.map((c) => (
                <li key={c.candidacyId}>
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
    </>
  );
}
