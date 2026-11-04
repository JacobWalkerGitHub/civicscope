import type { Metadata } from 'next';
import Link from 'next/link';
import {
  listStateOfficials,
  STATE_OFFICIAL_SEARCH_LIMIT,
  STATE_OFFICIAL_STATES,
  stateOfficialSlug,
  stateOfficialsCoverage,
  type StateOfficialFilters,
  type StateOfficialView,
} from '@civicscope/cms';
import { STATE_OFFICE_ROLES, stateNameFor, type StateOfficeRole } from '@civicscope/core';
import { Avatar, PageIntro, SourceNote } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { formatDate, stateChamberName, stateSeatLabel } from '@/lib/labels';
import { PoliticianTabs } from '../tabs';

export const metadata: Metadata = {
  title: 'Governors and state legislators · CivicScope',
  description:
    'The governors and state legislators in office now in all 50 states, from Open States’ records of each state’s official sites.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const OFFICE_OPTIONS: { value: StateOfficeRole; label: string }[] = [
  { value: 'governor', label: 'Governor' },
  { value: 'upper', label: 'State Senate' },
  { value: 'lower', label: 'State House or Assembly' },
  { value: 'legislature', label: 'Nebraska Legislature' },
];

const byStateName = STATE_OFFICIAL_STATES.map((code) => ({ code, name: stateNameFor(code) })).sort(
  (a, b) => a.name.localeCompare(b.name),
);

function groupTitle(role: StateOfficeRole, state: string | undefined) {
  if (role === 'governor') return state ? 'Governor' : 'Governors';
  if (!state) return OFFICE_OPTIONS.find((o) => o.value === role)!.label;
  return `${stateChamberName(state, role)}`;
}

export default async function StateOfficialsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const role = one(sp.office);
  const st = one(sp.state).toUpperCase();
  const filters: StateOfficialFilters = {
    q: one(sp.q).trim() || undefined,
    state: STATE_OFFICIAL_STATES.includes(st) ? st : undefined,
    role: (STATE_OFFICE_ROLES as readonly string[]).includes(role)
      ? (role as StateOfficeRole)
      : undefined,
    party: one(sp.party) || undefined,
  };
  const db = getDb();
  const [{ rows, capped, governorsOnly, parties }, coverage] = await Promise.all([
    listStateOfficials(db, filters),
    stateOfficialsCoverage(db),
  ]);
  const filtered = Boolean(filters.q || filters.state || filters.role || filters.party);
  const imported = coverage.some((c) => c.governor || c.legislators);
  const groups = STATE_OFFICE_ROLES.map((r) => ({
    role: r,
    title: groupTitle(r, filters.state),
    list: rows.filter((x) => x.role === r),
  })).filter((g) => g.list.length > 0);
  const missingGov = coverage.filter((c) => !c.governor).map((c) => stateNameFor(c.state));
  const missingLeg = coverage.filter((c) => !c.legislators).map((c) => stateNameFor(c.state));
  const verified = coverage
    .map((c) => c.verifiedOn)
    .filter((d): d is string => !!d)
    .sort();

  return (
    <>
      <PageIntro eyebrow="Who represents you" title="Governors and state legislators">
        <p>
          The governor and the members of the legislature in office now in each state. Pick a state
          to see its whole legislature. Looking for who is running? See{' '}
          <Link href="/politicians/candidates">Candidates</Link>.
        </p>
      </PageIntro>
      <PoliticianTabs current="state" />

      <form className="filter-bar" method="get" role="search" aria-label="Filter state officials">
        <div className="field grow">
          <label htmlFor="s-q">Name</label>
          <input id="s-q" type="search" name="q" defaultValue={filters.q ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="s-state">State</label>
          <select id="s-state" name="state" defaultValue={filters.state ?? ''}>
            <option value="">All states</option>
            {byStateName.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-office">Office</label>
          <select id="s-office" name="office" defaultValue={filters.role ?? ''}>
            <option value="">All offices</option>
            {OFFICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-party">Party</label>
          <select id="s-party" name="party" defaultValue={filters.party ?? ''}>
            <option value="">Any party</option>
            {parties.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit">Apply</button>
          {filtered && (
            <Link href="/politicians/state" className="button-quiet">
              Clear
            </Link>
          )}
        </div>
      </form>

      <p role="status" className="result-count">
        {!imported
          ? 'No governors or state legislators have been imported yet.'
          : rows.length === 0
            ? 'No one matches these filters.'
            : governorsOnly
              ? `${rows.length} governors, by state. Pick a state, or search by name, to see legislators.`
              : capped
                ? `The first ${STATE_OFFICIAL_SEARCH_LIMIT} matches, by state. Pick a state to narrow the list.`
                : `${rows.length} ${rows.length === 1 ? 'person' : 'people'}${filters.state ? ` in ${stateNameFor(filters.state)}` : ''}, alphabetical by last name.`}
      </p>

      {groups.map((g) => (
        <section key={g.role} aria-labelledby={`g-${g.role}`} className="member-group">
          <h2 id={`g-${g.role}`}>
            {g.title} <span className="muted count-inline">{g.list.length}</span>
          </h2>
          <ul className="member-grid">
            {g.list.map((m) => (
              <li key={m.id}>
                <OfficialCard m={m} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {imported && (
        <SourceNote>
          Names, offices, districts and parties come from{' '}
          <a href="https://openstates.org/" rel="noopener">
            Open States
          </a>
          , which collects them from each state’s official legislature and governor sites, and are
          rechecked daily. Each person’s page links the exact file and the date it was last verified
          {verified.length > 0 && (
            <> (the oldest listing here was verified {formatDate(verified[0]!)})</>
          )}
          . Vacant seats are not shown, and a recent change may take a few days to appear.
          Lieutenant governors and other statewide officials, the District of Columbia and the
          territories are not listed yet.
          {missingGov.length > 0 && <> No governor is listed for: {missingGov.join(', ')}.</>}
          {missingLeg.length > 0 && (
            <> No legislators are listed for: {missingLeg.join(', ')}.</>
          )}{' '}
          See <Link href="/coverage">Coverage</Link>, or{' '}
          <Link href="/corrections">report a mistake</Link>.
        </SourceNote>
      )}
    </>
  );
}

function OfficialCard({ m }: { m: StateOfficialView }) {
  return (
    <Link href={`/politicians/state/${stateOfficialSlug(m.osPersonId)}`} className="member-card">
      <Avatar name={m.name} />
      <span className="member-card-body">
        <span className="member-name">{m.name}</span>
        <span className="member-seat">{stateSeatLabel(m.role, m.state, m.district)}</span>
        {m.partyName && <span className="chip">{m.partyName}</span>}
      </span>
    </Link>
  );
}
