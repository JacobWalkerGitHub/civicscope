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
import { NotPublic, Sources, Thumb } from './sources';

type Comparison = NonNullable<Awaited<ReturnType<typeof getPublicComparison>>>;
type Column = Comparison['columns'][number];
type Entry = Column['positions'][number];

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
              <tr>
                <th scope="row">Accomplishments</th>
                {columns.map((c) => (
                  <td key={c.candidacyId}>
                    <Entries list={c.accomplishments} cites={citations.claim} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
