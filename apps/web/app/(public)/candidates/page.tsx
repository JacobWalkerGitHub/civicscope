import type { Metadata } from 'next';
import Link from 'next/link';
import {
  directoryFilterOptions,
  DIRECTORY_PAGE_SIZE,
  listPublicCandidates,
  type DirectoryFilters,
} from '@civicscope/cms';
import { Thumb } from '@/components/public/sources';
import { getDb } from '@/lib/db';
import { CANDIDACY_STATUS_LABELS, formatDate } from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Candidates · CivicScope',
  description: 'Search candidates for federal and state office, with sources for every fact.',
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const positiveInt = (v: string) => (/^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : undefined);
const LEVELS = { federal: 'Federal', state: 'State', local: 'Local' } as const;

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const level = one(sp.level);
  const filters: DirectoryFilters = {
    q: one(sp.q) || undefined,
    jurisdictionId: positiveInt(one(sp.state)),
    partyId: positiveInt(one(sp.party)),
    level: level in LEVELS ? (level as keyof typeof LEVELS) : undefined,
    includePast: one(sp.past) === '1',
  };
  const db = getDb();
  const [{ rows, total, page }, options] = await Promise.all([
    listPublicCandidates(db, filters, positiveInt(one(sp.page)) ?? 1),
    directoryFilterOptions(db),
  ]);
  const pages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    for (const key of ['q', 'state', 'level', 'party', 'past']) {
      const v = one(sp[key]);
      if (v) params.set(key, v);
    }
    if (n > 1) params.set('page', String(n));
    const qs = params.toString();
    return qs ? `/candidates?${qs}` : '/candidates';
  };

  return (
    <>
      <h1>Candidates</h1>
      <form className="filters" method="get" role="search" aria-label="Filter candidates">
        <div className="field">
          <label htmlFor="f-q">Name</label>
          <input id="f-q" type="search" name="q" defaultValue={filters.q ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-state">State</label>
          <select id="f-state" name="state" defaultValue={filters.jurisdictionId ?? ''}>
            <option value="">All states</option>
            {options.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-level">Level</label>
          <select id="f-level" name="level" defaultValue={filters.level ?? ''}>
            <option value="">All levels</option>
            {Object.entries(LEVELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-party">Party on the ballot</label>
          <select id="f-party" name="party" defaultValue={filters.partyId ?? ''}>
            <option value="">Any party</option>
            {options.parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <label className="inline">
          <input type="checkbox" name="past" value="1" defaultChecked={filters.includePast} />
          Include past elections
        </label>
        <button type="submit">Search</button>
      </form>

      <p role="status">
        {total === 0
          ? 'No candidates match.'
          : `${total} candidac${total === 1 ? 'y' : 'ies'}, listed alphabetically by last name.`}
      </p>
      {rows.length > 0 && (
        <ul className="candidate-list">
          {rows.map((r) => (
            <li key={r.candidacyId} className="with-thumb">
              <Thumb photoId={r.photoId} name={r.ballotName} />
              <h2 className="h3">
                <Link href={`/candidates/${r.personSlug}`}>{r.ballotName}</Link>
              </h2>
              <p>
                <Link href={`/races/${r.raceId}`}>{r.raceName}</Link> · {r.jurisdictionName} ·{' '}
                {formatDate(r.electionDate)}
              </p>
              <p className="muted">
                {r.partyName ?? 'No party listed'}
                {r.isIncumbent && ' · Incumbent'}
                {r.status && <> · {CANDIDACY_STATUS_LABELS[r.status]}</>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && <Link href={pageHref(page - 1)}>← Previous</Link>}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={pageHref(page + 1)}>Next →</Link>}
        </nav>
      )}
    </>
  );
}
