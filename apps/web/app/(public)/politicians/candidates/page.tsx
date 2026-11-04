import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CANDIDATE_OUTCOMES,
  directoryFilterOptions,
  DIRECTORY_PAGE_SIZE,
  listPublicCandidates,
  type CandidateOutcome,
  type DirectoryFilters,
} from '@civicscope/cms';
import { StatusBadge, statusTone } from '@/components/public/badges';
import { Thumb } from '@/components/public/sources';
import { PageIntro, Pager } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { ELECTION_TYPE_LABELS, formatDate } from '@/lib/labels';
import { PoliticianTabs } from '../tabs';

export const metadata: Metadata = {
  title: 'Candidates · CivicScope',
  description:
    'Every candidate in every election CivicScope covers, past and upcoming, with who won and lost and a source for every fact.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const positiveInt = (v: string) => (/^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : undefined);
const LEVELS = { federal: 'Federal', state: 'State', local: 'Local' } as const;
const OUTCOME_LABELS: Record<CandidateOutcome, string> = {
  won: 'Won',
  lost: 'Lost',
  running: 'Still running',
  withdrawn: 'Withdrew or disqualified',
};

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const level = one(sp.level);
  const outcome = one(sp.outcome);
  // All elections by default; "upcoming" narrows to elections still ahead.
  const when = one(sp.when) === 'upcoming' ? 'upcoming' : 'all';
  const filters: DirectoryFilters = {
    q: one(sp.q) || undefined,
    jurisdictionId: positiveInt(one(sp.state)),
    partyId: positiveInt(one(sp.party)),
    level: level in LEVELS ? (level as keyof typeof LEVELS) : undefined,
    includePast: when === 'all' || one(sp.past) === '1',
    outcome: (CANDIDATE_OUTCOMES as readonly string[]).includes(outcome)
      ? (outcome as CandidateOutcome)
      : undefined,
    year: positiveInt(one(sp.year)),
  };
  const db = getDb();
  const [{ rows, total, page }, options] = await Promise.all([
    listPublicCandidates(db, filters, positiveInt(one(sp.page)) ?? 1),
    directoryFilterOptions(db),
  ]);
  const pages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));
  const keys = ['q', 'state', 'level', 'party', 'outcome', 'year', 'when'];
  const href = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const key of keys) {
      const v = key in changes ? changes[key] : one(sp[key]);
      if (v) params.set(key, v);
    }
    if (changes.page) params.set('page', changes.page);
    const qs = params.toString();
    return qs ? `/politicians/candidates?${qs}` : '/politicians/candidates';
  };
  const filtered = keys.some((k) => one(sp[k]));

  return (
    <>
      <PageIntro eyebrow="Who is running" title="Politicians">
        <p>
          Every candidate in the elections CivicScope covers, past and upcoming, with who won and
          who lost. Each status links to the official record it comes from.
        </p>
      </PageIntro>
      <PoliticianTabs current="candidates" />

      <nav className="chip-filters" aria-label="Filter by outcome">
        <Link
          href={href({ outcome: undefined, page: undefined })}
          aria-current={!filters.outcome ? 'page' : undefined}
        >
          Everyone
        </Link>
        {CANDIDATE_OUTCOMES.map((o) => (
          <Link
            key={o}
            href={href({ outcome: o, page: undefined })}
            aria-current={filters.outcome === o ? 'page' : undefined}
          >
            {OUTCOME_LABELS[o]}
          </Link>
        ))}
      </nav>

      <form className="filter-bar" method="get" role="search" aria-label="Filter candidates">
        {filters.outcome && <input type="hidden" name="outcome" value={filters.outcome} />}
        <div className="field grow">
          <label htmlFor="f-q">Name</label>
          <input id="f-q" type="search" name="q" defaultValue={filters.q ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="f-year">Election year</label>
          <select id="f-year" name="year" defaultValue={filters.year ?? ''}>
            <option value="">All years</option>
            {options.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
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
          <input
            type="checkbox"
            name="when"
            value="upcoming"
            defaultChecked={when === 'upcoming'}
          />
          Upcoming elections only
        </label>
        <div className="filter-actions">
          <button type="submit">Apply</button>
          {filtered && (
            <Link href="/politicians/candidates" className="button-quiet">
              Clear
            </Link>
          )}
        </div>
      </form>

      <p role="status" className="result-count">
        {total === 0
          ? 'No candidates match.'
          : `${total} candidac${total === 1 ? 'y' : 'ies'}, listed alphabetically by last name.`}
      </p>
      {rows.length > 0 && (
        <ul className="candidate-grid">
          {rows.map((r) => (
            <li key={r.candidacyId} className={`candidate-card card-${statusTone(r.status)}`}>
              <Thumb photoId={r.photoId} name={r.ballotName} />
              <div className="candidate-card-body">
                <h2 className="h3">
                  <Link href={`/candidates/${r.personSlug}`}>{r.ballotName}</Link>
                </h2>
                <p className="candidate-race">
                  <Link href={`/races/${r.raceId}`}>{r.raceName}</Link>
                </p>
                <p className="muted small">
                  {r.jurisdictionName} · {ELECTION_TYPE_LABELS[r.electionType]} ·{' '}
                  {formatDate(r.electionDate)}
                </p>
                <div className="badge-row">
                  <StatusBadge status={r.status} />
                  {r.partyName && <span className="chip">{r.partyName}</span>}
                  {r.isIncumbent && <span className="chip">Incumbent</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={page}
        pages={pages}
        href={(n) => href({ page: n > 1 ? String(n) : undefined })}
      />
    </>
  );
}
