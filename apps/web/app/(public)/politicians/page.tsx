import type { Metadata } from 'next';
import Link from 'next/link';
import { listCurrentMembers, type MemberFilters } from '@civicscope/cms';
import { stateNameFor } from '@civicscope/core';
import { FilterPanel } from '@/components/public/filter-panel';
import { Avatar, PageIntro, SourceNote } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { ordinal, seatLabel } from '@/lib/labels';
import { partyTone } from '@/lib/party';
import { partyViewOn } from '@/lib/party-view';
import { PartyChip, ViewBar } from '@/components/public/view-bar';
import { PoliticianTabs } from './tabs';

export const metadata: Metadata = {
  title: 'Politicians · CivicScope',
  description:
    'Members of Congress serving now, with the bills they sponsor and how they vote, from official records.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** The seat without the state, for lists already grouped under a state heading. */
function shortSeat(chamber: 'house' | 'senate', district: number | null) {
  if (chamber === 'senate') return 'U.S. Senator';
  if (district === 0 || district == null) return 'U.S. Representative, at large';
  return `U.S. Representative, District ${district}`;
}

export default async function PoliticiansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const chamber = one(sp.chamber);
  const showParty = await partyViewOn();
  const view = one(sp.view) === 'state' ? 'state' : 'list';
  const filters: MemberFilters = {
    q: one(sp.q) || undefined,
    chamber: chamber === 'house' || chamber === 'senate' ? chamber : undefined,
    state: /^[A-Za-z]{2}$/.test(one(sp.state)) ? one(sp.state).toUpperCase() : undefined,
    // With party labels off, party is not shown or filtered on anywhere.
    party: (showParty && one(sp.party)) || undefined,
  };
  const { congress, rows, parties, states } = await listCurrentMembers(getDb(), filters);
  const filtered = Boolean(filters.q || filters.chamber || filters.state || filters.party);

  const groups =
    view === 'state'
      ? [...new Set(rows.map((r) => r.state))]
          .map((code) => ({
            key: code.toLowerCase(),
            title: stateNameFor(code),
            // Senators first, then House seats in district order.
            list: rows
              .filter((r) => r.state === code)
              .sort(
                (a, b) =>
                  (a.chamber === 'senate' ? 0 : 1) - (b.chamber === 'senate' ? 0 : 1) ||
                  (a.district ?? 0) - (b.district ?? 0) ||
                  a.name.localeCompare(b.name),
              ),
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      : [
          { key: 'senate', title: 'Senate', list: rows.filter((r) => r.chamber === 'senate') },
          {
            key: 'house',
            title: 'House of Representatives',
            list: rows.filter((r) => r.chamber === 'house'),
          },
        ].filter((g) => g.list.length > 0);

  const href = (v: 'list' | 'state') => {
    const params = new URLSearchParams();
    for (const key of ['q', 'chamber', 'state', 'party'])
      if (one(sp[key])) params.set(key, one(sp[key]));
    if (v === 'state') params.set('view', 'state');
    const qs = params.toString();
    return qs ? `/politicians?${qs}` : '/politicians';
  };

  return (
    <>
      <PageIntro eyebrow="Who represents you" title="Politicians">
        <p>
          Members of Congress in office now, with the bills they sponsor and every recorded vote
          they cast. Governors and state legislators are on their own tab. Looking for who is
          running? See <Link href="/politicians/candidates">Candidates</Link>.
        </p>
      </PageIntro>
      <PoliticianTabs current="office" />

      <ViewBar
        view={view}
        listHref={href('list')}
        stateHref={href('state')}
        listLabel="By chamber"
        partyOn={showParty}
      />

      <FilterPanel
        id="p-filters"
        active={[filters.q, filters.chamber, filters.state, filters.party].filter(Boolean).length}
      >
        <form className="filter-bar" method="get" role="search" aria-label="Filter politicians">
          {view === 'state' && <input type="hidden" name="view" value="state" />}
          <div className="field grow">
            <label htmlFor="p-q">Name</label>
            <input id="p-q" type="search" name="q" defaultValue={filters.q ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="p-chamber">Chamber</label>
            <select id="p-chamber" name="chamber" defaultValue={filters.chamber ?? ''}>
              <option value="">Both</option>
              <option value="senate">Senate</option>
              <option value="house">House</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-state">State</label>
            <select id="p-state" name="state" defaultValue={filters.state ?? ''}>
              <option value="">All states</option>
              {states
                .map((s) => ({ code: s, name: stateNameFor(s) }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          {showParty && (
            <div className="field">
              <label htmlFor="p-party">Party</label>
              <select id="p-party" name="party" defaultValue={filters.party ?? ''}>
                <option value="">Any party</option>
                {parties.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-actions">
            <button type="submit">Apply</button>
            {filtered && (
              <Link
                href={view === 'state' ? '/politicians?view=state' : '/politicians'}
                className="button-quiet"
              >
                Clear
              </Link>
            )}
          </div>
        </form>
      </FilterPanel>

      <p role="status" className="result-count">
        {congress == null
          ? 'No Members of Congress have been imported yet.'
          : rows.length === 0
            ? 'No one matches these filters.'
            : `${rows.length} ${rows.length === 1 ? 'member' : 'members'} of the ${ordinal(congress)} Congress, ${
                view === 'state'
                  ? `in ${groups.length} ${groups.length === 1 ? 'state' : 'states and territories'}.`
                  : 'alphabetical by last name.'
              }`}
      </p>

      {groups.length > 1 && (
        <nav
          aria-label={view === 'state' ? 'Jump to a state' : 'Jump to a chamber'}
          className={`jump-links${view === 'state' ? ' jump-states' : ''}`}
        >
          <span>Jump to:</span>
          {groups.map((g) => (
            <a
              key={g.key}
              href={`#g-${g.key}`}
              aria-label={view === 'state' ? g.title : undefined}
              title={view === 'state' ? g.title : undefined}
            >
              {view === 'state' ? g.key.toUpperCase() : g.title}
            </a>
          ))}
        </nav>
      )}

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`} className="member-group">
          <h2 id={`g-${g.key}`}>
            {g.title} <span className="muted count-inline">{g.list.length}</span>
          </h2>
          <ul className="member-grid">
            {g.list.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/politicians/${m.bioguideId}`}
                  className={`member-card${
                    showParty && m.partyName ? ` party-card party-${partyTone(m.partyName)}` : ''
                  }`}
                >
                  <Avatar name={m.name} photoId={m.photoId} />
                  <span className="member-card-body">
                    <span className="member-name">{m.name}</span>
                    <span className="member-seat">
                      {view === 'state'
                        ? shortSeat(m.chamber, m.district)
                        : seatLabel(m.chamber, m.state, m.district)}
                    </span>
                    {showParty && m.partyName && <PartyChip name={m.partyName} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <SourceNote>
        Members and their seats come from Congress.gov. Governors and state legislators are on the{' '}
        <Link href="/politicians/state">States</Link> tab; other state officeholders are not listed
        yet. See <Link href="/coverage">Coverage</Link>.
      </SourceNote>
    </>
  );
}
