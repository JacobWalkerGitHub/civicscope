import type { Metadata } from 'next';
import Link from 'next/link';
import { listCurrentMembers, type MemberFilters } from '@civicscope/cms';
import { stateNameFor } from '@civicscope/core';
import { Avatar, PageIntro, SourceNote } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { ordinal, seatLabel } from '@/lib/labels';
import { PoliticianTabs } from './tabs';

export const metadata: Metadata = {
  title: 'Politicians · CivicScope',
  description:
    'Members of Congress serving now, with the bills they sponsor and how they vote, from official records.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function PoliticiansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const chamber = one(sp.chamber);
  const filters: MemberFilters = {
    q: one(sp.q) || undefined,
    chamber: chamber === 'house' || chamber === 'senate' ? chamber : undefined,
    state: /^[A-Za-z]{2}$/.test(one(sp.state)) ? one(sp.state).toUpperCase() : undefined,
    party: one(sp.party) || undefined,
  };
  const { congress, rows, parties, states } = await listCurrentMembers(getDb(), filters);
  const senators = rows.filter((r) => r.chamber === 'senate');
  const reps = rows.filter((r) => r.chamber === 'house');
  const filtered = Boolean(filters.q || filters.chamber || filters.state || filters.party);

  const groups = [
    { key: 'senate', title: 'Senate', list: senators },
    { key: 'house', title: 'House of Representatives', list: reps },
  ].filter((g) => g.list.length > 0);

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

      <form className="filter-bar" method="get" role="search" aria-label="Filter politicians">
        <div className="field grow">
          <label htmlFor="p-q">Name</label>
          <input id="p-q" type="search" name="q" defaultValue={filters.q ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="p-chamber">Chamber</label>
          <select id="p-chamber" name="chamber" defaultValue={filters.chamber ?? ''}>
            <option value="">Senate and House</option>
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
        <div className="filter-actions">
          <button type="submit">Apply</button>
          {filtered && (
            <Link href="/politicians" className="button-quiet">
              Clear
            </Link>
          )}
        </div>
      </form>

      <p role="status" className="result-count">
        {congress == null
          ? 'No Members of Congress have been imported yet.'
          : rows.length === 0
            ? 'No one matches these filters.'
            : `${rows.length} ${rows.length === 1 ? 'member' : 'members'} of the ${ordinal(congress)} Congress, alphabetical by last name.`}
      </p>

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`} className="member-group">
          <h2 id={`g-${g.key}`}>
            {g.title} <span className="muted count-inline">{g.list.length}</span>
          </h2>
          <ul className="member-grid">
            {g.list.map((m) => (
              <li key={m.id}>
                <Link href={`/politicians/${m.bioguideId}`} className="member-card">
                  <Avatar name={m.name} />
                  <span className="member-card-body">
                    <span className="member-name">{m.name}</span>
                    <span className="member-seat">{seatLabel(m.chamber, m.state, m.district)}</span>
                    {m.partyName && <span className="chip">{m.partyName}</span>}
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
