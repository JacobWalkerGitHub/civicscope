import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BILL_PAGE_SIZE,
  BILL_TABS,
  billOverview,
  listPublicBills,
  type BillFilters,
  type BillTab,
} from '@civicscope/cms';
import { BILL_STAGES, FINAL_BILL_STAGES, type BillStage } from '@civicscope/core';
import { PageIntro, Pager, SourceNote, StageBadge, Tabs } from '@/components/public/ui';
import { getDb } from '@/lib/db';
import { BILL_STAGE_LABELS, formatDate, ordinal } from '@/lib/labels';

export const metadata: Metadata = {
  title: 'Bills · CivicScope',
  description:
    'Bills in Congress: what passed or failed, what is moving, and who sponsored and voted on each one, from Congress.gov.',
};

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const positiveInt = (v: string) => (/^\d{1,9}$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

const TAB_LABELS: Record<BillTab, string> = {
  outcomes: 'Passed & failed',
  progress: 'In progress',
  all: 'All bills',
};
const TAB_HELP: Record<BillTab, string> = {
  outcomes:
    'Bills that became law, resolutions that were adopted, and measures that were vetoed or failed a vote, most recent first.',
  progress:
    'Bills still moving through Congress, from introduction to passing one or both chambers, most recently active first.',
  all: 'Every bill CivicScope has imported, most recently active first.',
};

export default async function BillsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tab: BillTab = (BILL_TABS as readonly string[]).includes(one(sp.tab))
    ? (one(sp.tab) as BillTab)
    : 'outcomes';
  const stageParam = one(sp.stage);
  const tabStages = BILL_STAGES.filter((s) =>
    tab === 'all'
      ? true
      : tab === 'outcomes'
        ? FINAL_BILL_STAGES.includes(s)
        : !FINAL_BILL_STAGES.includes(s),
  );
  const filters: BillFilters = {
    tab,
    q: one(sp.q) || undefined,
    congress: positiveInt(one(sp.congress)),
    chamber:
      one(sp.chamber) === 'house' || one(sp.chamber) === 'senate'
        ? (one(sp.chamber) as 'house' | 'senate')
        : undefined,
    stage: (tabStages as readonly string[]).includes(stageParam)
      ? (stageParam as BillStage)
      : undefined,
    policyArea: one(sp.area) || undefined,
  };
  const db = getDb();
  const [overview, { rows, total, page }] = await Promise.all([
    billOverview(db),
    listPublicBills(db, filters, positiveInt(one(sp.page)) ?? 1),
  ]);
  const pages = Math.max(1, Math.ceil(total / BILL_PAGE_SIZE));
  const href = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const key of ['tab', 'q', 'congress', 'chamber', 'stage', 'area']) {
      const v = key in changes ? changes[key] : one(sp[key]);
      if (v) params.set(key, v);
    }
    if (changes.page) params.set('page', changes.page);
    const qs = params.toString();
    return qs ? `/bills?${qs}` : '/bills';
  };
  const filtered = Boolean(
    filters.q || filters.congress || filters.chamber || filters.stage || filters.policyArea,
  );

  return (
    <>
      <PageIntro eyebrow="Congress" title="Bills">
        <p>
          What Congress passed and rejected, what is still moving, and who sponsored and voted on
          each bill. Every bill links to its record on Congress.gov and its full text.
        </p>
      </PageIntro>

      <Tabs
        label="Bill lists"
        items={BILL_TABS.map((t) => ({
          href: t === 'outcomes' ? '/bills' : `/bills?tab=${t}`,
          label: TAB_LABELS[t],
          count: overview[t === 'all' ? 'total' : t],
          current: t === tab,
        }))}
      />
      <p className="tab-help">{TAB_HELP[tab]}</p>

      <form className="filter-bar" method="get" role="search" aria-label="Filter bills">
        {tab !== 'outcomes' && <input type="hidden" name="tab" value={tab} />}
        <div className="field grow">
          <label htmlFor="b-q">Title or number</label>
          <input
            id="b-q"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="e.g. H.R. 1 or energy"
          />
        </div>
        <div className="field">
          <label htmlFor="b-chamber">Chamber</label>
          <select id="b-chamber" name="chamber" defaultValue={filters.chamber ?? ''}>
            <option value="">Both</option>
            <option value="house">House bills</option>
            <option value="senate">Senate bills</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="b-stage">Status</label>
          <select id="b-stage" name="stage" defaultValue={filters.stage ?? ''}>
            <option value="">Any</option>
            {tabStages.map((s) => (
              <option key={s} value={s}>
                {BILL_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {overview.policyAreas.length > 0 && (
          <div className="field">
            <label htmlFor="b-area">Topic</label>
            <select id="b-area" name="area" defaultValue={filters.policyArea ?? ''}>
              <option value="">Any topic</option>
              {overview.policyAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        {overview.congresses.length > 1 && (
          <div className="field">
            <label htmlFor="b-congress">Congress</label>
            <select id="b-congress" name="congress" defaultValue={filters.congress ?? ''}>
              <option value="">All</option>
              {overview.congresses.map((c) => (
                <option key={c} value={c}>
                  {ordinal(c)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="filter-actions">
          <button type="submit">Apply</button>
          {filtered && (
            <Link
              href={href({
                q: undefined,
                congress: undefined,
                chamber: undefined,
                stage: undefined,
                area: undefined,
              })}
              className="button-quiet"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <p role="status" className="result-count">
        {total === 0
          ? overview.total === 0
            ? 'No bills have been imported yet.'
            : 'No bills match these filters.'
          : `${total.toLocaleString('en-US')} ${total === 1 ? 'bill' : 'bills'}`}
      </p>

      {rows.length > 0 && (
        <ul className="bill-list">
          {rows.map((b) => (
            <li key={b.id} className="bill-card">
              <div className="bill-card-top">
                <span className="bill-number">{b.label}</span>
                <StageBadge stage={b.stage} />
                {b.policyArea && <span className="chip">{b.policyArea}</span>}
              </div>
              <h2 className="bill-title">
                <Link href={`/bills/${b.congress}/${b.billType}/${b.number}`}>{b.title}</Link>
              </h2>
              <p className="bill-meta">
                {b.sponsor ? (
                  <>
                    Sponsor:{' '}
                    <Link href={`/politicians/${b.sponsor.bioguideId}`}>{b.sponsor.name}</Link>
                    {b.sponsor.party && b.sponsor.state && (
                      <span className="muted">
                        {' '}
                        ({b.sponsor.party}-{b.sponsor.state})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted">No sponsor listed</span>
                )}
                {b.introducedOn && <> · Introduced {formatDate(b.introducedOn)}</>}
              </p>
              {b.latestActionText && (
                <p className="bill-action">
                  {b.latestActionOn && (
                    <time dateTime={b.latestActionOn}>{formatDate(b.latestActionOn)}</time>
                  )}
                  {b.latestActionText}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={page}
        pages={pages}
        href={(n) => href({ page: n > 1 ? String(n) : undefined })}
      />

      <SourceNote>
        From the Library of Congress (Congress.gov). The status label is worked out from each bill’s
        latest action, which is shown in its own words. CivicScope covers the{' '}
        {overview.congresses.length ? overview.congresses.map(ordinal).join(', ') : 'current'}{' '}
        Congress; state bills are not listed here yet. See{' '}
        <Link href="/methodology">how we work</Link>.
      </SourceNote>
    </>
  );
}
