import Link from 'next/link';
import type { CurrentOffice, ElectionOutcome, NextOffice, OfficeTimeline } from '@civicscope/cms';
import { ExternalLink } from '@/components/external-link';
import { ELECTION_TYPE_LABELS, formatDate, seatLabel, stateSeatLabel } from '@/lib/labels';
import { StatusBadge, statusTone } from './badges';

/** "Governor of Florida", from race "Governor", office "Governor of Florida", state Florida. */
export function raceOfficeLabel(
  e: Pick<ElectionOutcome, 'raceName' | 'officeTitle' | 'jurisdictionName'>,
) {
  const { raceName, officeTitle, jurisdictionName: place } = e;
  if (place === 'United States' || raceName.includes(place)) return raceName;
  if (officeTitle.includes(place) && officeTitle.startsWith(raceName)) return officeTitle;
  return `${raceName}, ${place}`;
}

function currentLabel(o: CurrentOffice) {
  return o.kind === 'congress'
    ? seatLabel(o.chamber, o.state, o.district)
    : stateSeatLabel(o.role, o.state, o.district);
}

function currentHref(o: CurrentOffice) {
  return o.kind === 'congress'
    ? `/politicians/${o.bioguideId}`
    : `/politicians/state/${o.osPersonId.replace(/^ocd-person\//, '')}`;
}

function NextLine({ n, raceHref }: { n: NextOffice; raceHref: (id: number) => string }) {
  return (
    <li>
      <strong>
        <Link href={raceHref(n.raceId)}>{raceOfficeLabel(n)}</Link>
      </strong>
      <span className="office-when">
        {n.termStartsOn ? (
          <>
            Takes office <strong>{formatDate(n.termStartsOn)}</strong> (
            <ExternalLink
              href={n.termStartSourceUrl!}
              label="source for the date"
              rel="noopener noreferrer"
            />
            )
          </>
        ) : (
          <>Start date not yet recorded by CivicScope</>
        )}
      </span>
      <span className="small muted">
        {n.isIncumbent ? 'Re-elected' : 'Won'} the {n.electionName}, {formatDate(n.electionDate)}
        {n.winSource && (
          <>
            {' · '}
            <ExternalLink
              href={n.winSource.url}
              label={`Result: ${n.winSource.publisher}`}
              rel="noopener noreferrer"
            />
          </>
        )}
      </span>
    </li>
  );
}

/**
 * "Now" and "Next": the office records list them in now, and an office they have won and
 * will take. Renders nothing when neither is known, so nothing is implied.
 */
export function OfficeNowNext({
  timeline,
  raceHref,
  linkCurrent = true,
  showCurrent = true,
}: {
  timeline: OfficeTimeline;
  raceHref: (id: number) => string;
  /** Link each current office to its politician page (off on that page itself). */
  linkCurrent?: boolean;
  /** Off where the page's own header already names the current office. */
  showCurrent?: boolean;
}) {
  const current = showCurrent ? timeline.current : [];
  const { next } = timeline;
  if (!current.length && !next.length) return null;
  return (
    <div className="office-now-next">
      {current.length > 0 && (
        <section className="office-panel" aria-labelledby="office-now-h">
          <h2 id="office-now-h" className="office-eyebrow">
            Currently serves as
          </h2>
          <ul>
            {current.map((o) => (
              <li key={`${o.kind}-${currentLabel(o)}`}>
                <strong>
                  {linkCurrent ? (
                    <Link href={currentHref(o)}>{currentLabel(o)}</Link>
                  ) : (
                    currentLabel(o)
                  )}
                </strong>
                <span className="small muted">
                  {o.kind === 'congress'
                    ? `In this chamber since ${o.startYear}`
                    : o.termStart
                      ? `Term began ${formatDate(o.termStart)}`
                      : `Listed on the state's site as of ${formatDate(o.lastSeenOn)}`}
                  {' · '}
                  <ExternalLink href={o.sourceUrl} label="Source" rel="noopener noreferrer" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {next.length > 0 && (
        <section className="office-panel office-next" aria-labelledby="office-next-h">
          <h2 id="office-next-h" className="office-eyebrow">
            Elected to
          </h2>
          <ul>
            {next.map((n) => (
              <NextLine key={n.candidacyId} n={n} raceHref={raceHref} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function outcomeNote(e: ElectionOutcome) {
  if (e.status) return null;
  return e.electionDate >= today() ? 'Upcoming' : 'Result not yet recorded';
}

/** One small card per election the person ran in, each linking to the race page. */
export function ElectionCards({
  elections,
  raceHref,
  headingId = 'elections-h',
  showParty = true,
}: {
  elections: ElectionOutcome[];
  raceHref: (id: number) => string;
  headingId?: string;
  /** False when the visitor has party labels off. */
  showParty?: boolean;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Elections</h2>
      {elections.length === 0 ? (
        <p className="muted">No published candidacies yet.</p>
      ) : (
        <ul className="election-cards">
          {elections.map((e) => (
            <li key={e.candidacyId} className={`election-card card-${statusTone(e.status)}`}>
              <Link href={raceHref(e.raceId)} className="election-card-link">
                <span className="election-card-top">
                  <StatusBadge status={e.status} date={e.statusDate} />
                  {outcomeNote(e) && <span className="small muted">{outcomeNote(e)}</span>}
                </span>
                <strong className="election-card-office">{raceOfficeLabel(e)}</strong>
                <span className="small">
                  {ELECTION_TYPE_LABELS[e.electionType]} · {formatDate(e.electionDate)}
                </span>
                {(showParty || e.isIncumbent) && (
                  <span className="small muted">
                    {showParty && (e.partyName ?? 'No party listed')}
                    {showParty && e.isIncumbent && ' · '}
                    {e.isIncumbent && 'Incumbent'}
                  </span>
                )}
                <span className="election-card-more small">Full race →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
