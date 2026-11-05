import { and, asc, desc, eq, inArray, isNull, like, notInArray, or, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { parseCsv, stateNameFor, type StateOfficeRole } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import {
  ensureImportSource,
  fetchText,
  OPENSTATES_ACCOUNT,
  systemActor,
  todayUtc,
  type FetchOptions,
} from './ingest-common';
import type { Tx } from './changes';

const { ingestRun, ingestSnapshot, person, personIdentifier, source, stateOfficeholder } = schema;

/*
 * Governors and state legislators in office, for the public Politicians page.
 *
 * Both come from Open States, which keeps them from each state's official sites:
 *   - Legislators: the public "current legislators" CSV for each state
 *     (data.openstates.org/people/current/<state>.csv). No API key needed.
 *   - Governors: the executive-branch files in the openstates/people repository on
 *     GitHub, which the CSVs leave out. A file counts only if it gives a governor role
 *     whose term includes today.
 *
 * Nothing is guessed. A state whose file cannot be read, or reads oddly (no governor,
 * two governors, far fewer legislators than last time), keeps what it had and is listed
 * for an editor; it is never emptied. Every row records the day it was last seen in the
 * source, which the public page shows as its "verified" date.
 */

export const STATE_OFFICIALS_CSV_BASE = 'https://data.openstates.org/people/current';
export const OPENSTATES_PEOPLE_REPO = 'openstates/people';
export const GITHUB_API = 'https://api.github.com';
export const GITHUB_RAW = 'https://raw.githubusercontent.com';

/** The 50 states. D.C. and the territories have no governor and state legislature. */
export const STATE_OFFICIAL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY',
]; // prettier-ignore

/**
 * A state whose new list has fewer than this share of the legislators listed now is
 * not trusted: its rows are kept as they are and it is flagged.
 */
export const MIN_LEGISLATOR_SHARE = 0.5;

/** Official sites outside .gov and .us. */
const OFFICIAL_HOSTS = ['senate.mn'];

export interface StateOfficial {
  osPersonId: string;
  state: string;
  role: StateOfficeRole;
  district: string | null;
  name: string;
  sortName: string;
  partyName: string | null;
  officialUrl: string | null;
  termStart: string | null;
  termEnd: string | null;
}

export interface StateOfficialsAttention {
  state: string;
  problem: string;
}

export interface StateOfficialsStateSummary {
  state: string;
  governor: string | null;
  legislators: number;
  added: number;
  updated: number;
  left: number;
  /** False when this state's list was not read or not trusted, and was left as it was. */
  refreshed: boolean;
}

export interface StateOfficialsSummary {
  requests: number;
  states: StateOfficialsStateSummary[];
  attention: StateOfficialsAttention[];
}

export interface StateOfficialsOptions extends FetchOptions {
  states?: string[];
  csvBase?: string;
  githubApi?: string;
  githubRaw?: string;
  /** Sent to GitHub when set, for a higher rate limit. Optional. */
  githubToken?: string;
  startedBy?: number | null;
  today?: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** The first link on a state government site (.gov, .us), or null. */
export function officialLink(urls: (string | null | undefined)[]): string | null {
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const host = hostOf(url);
    if (
      host.endsWith('.gov') ||
      host.endsWith('.us') ||
      OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    ) {
      return url.slice(0, 500);
    }
  }
  return null;
}

const sortNameOf = (name: string, given?: string | null, family?: string | null) =>
  given?.trim() && family?.trim() ? `${family.trim()}, ${given.trim()}` : name;

const CHAMBERS: Record<string, StateOfficeRole> = {
  upper: 'upper',
  lower: 'lower',
  legislature: 'legislature',
};

/** Legislators from an Open States "current" CSV. Rows without an ID, name or chamber are skipped. */
export function parseLegislatorCsv(state: string, text: string): StateOfficial[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = new Map(header.cells.map((c, i) => [c.trim(), i] as const));
  for (const need of ['id', 'name', 'current_chamber']) {
    if (!col.has(need)) throw new Error(`${state} legislator file has no "${need}" column.`);
  }
  const get = (cells: string[], name: string) => {
    const i = col.get(name);
    return i == null ? '' : (cells[i] ?? '').trim();
  };
  const out: StateOfficial[] = [];
  const seen = new Set<string>();
  for (const { cells } of rows) {
    const id = get(cells, 'id');
    const name = get(cells, 'name');
    const role = CHAMBERS[get(cells, 'current_chamber')];
    if (!id.startsWith('ocd-person/') || !name || !role) continue;
    if (seen.has(`${id}|${role}`)) continue;
    seen.add(`${id}|${role}`);
    const split = (v: string) => v.split(';').map((s) => s.trim());
    out.push({
      osPersonId: id.slice(0, 80),
      state,
      role,
      district: get(cells, 'current_district').slice(0, 60) || null,
      name: name.slice(0, 200),
      sortName: sortNameOf(name, get(cells, 'given_name'), get(cells, 'family_name')).slice(0, 200),
      partyName: get(cells, 'current_party').slice(0, 100) || null,
      officialUrl: officialLink([...split(get(cells, 'links')), ...split(get(cells, 'sources'))]),
      termStart: null,
      termEnd: null,
    });
  }
  return out;
}

interface PeopleFile {
  id?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  party?: { name?: string; start_date?: string; end_date?: string }[];
  roles?: {
    type?: string;
    start_date?: string;
    end_date?: string;
    end_reason?: string;
    jurisdiction?: string;
  }[];
  links?: { url?: string }[];
  sources?: { url?: string }[];
}

const dateOf = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * The governor in an openstates/people executive file, if the file gives a governor role
 * for this state whose term includes today. A term with no start counts as started; a
 * term with no end counts as running.
 */
export function governorFromFile(state: string, text: string, today: string): StateOfficial | null {
  const doc = parseYaml(text) as PeopleFile | null;
  if (!doc?.id || !doc.name) return null;
  const jurisdiction = `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government`;
  const role = (doc.roles ?? []).find((r) => {
    if (r.type !== 'governor' || r.jurisdiction !== jurisdiction) return false;
    const start = dateOf(r.start_date);
    const end = dateOf(r.end_date);
    return (!start || start <= today) && (!end || end > today);
  });
  if (!role) return null;
  const party =
    (doc.party ?? []).find((p) => {
      const end = dateOf(p.end_date);
      return p.name && (!end || end > today);
    })?.name ?? null;
  return {
    osPersonId: String(doc.id).slice(0, 80),
    state,
    role: 'governor',
    district: null,
    name: doc.name.slice(0, 200),
    sortName: sortNameOf(doc.name, doc.given_name, doc.family_name).slice(0, 200),
    partyName: party?.slice(0, 100) ?? null,
    officialUrl: officialLink([
      ...(doc.links ?? []).map((l) => l.url),
      ...(doc.sources ?? []).map((l) => l.url),
    ]),
    termStart: dateOf(role.start_date),
    termEnd: dateOf(role.end_date),
  };
}

class Fetcher {
  requests = 0;
  constructor(
    private readonly opts: StateOfficialsOptions,
    private readonly db: Db,
    private readonly runId: number,
  ) {}

  async get(url: string, accept: string, headers: Record<string, string> = {}, keep = true) {
    this.requests++;
    const body = await fetchText(new URL(url), this.opts, accept, headers);
    if (keep) await this.snapshot(url, body);
    return body;
  }

  /**
   * Keeps the body as this run's copy of the URL, unless an earlier run of this import
   * already kept exactly the same text: most files do not change from day to day.
   */
  private async snapshot(url: string, body: string) {
    const [same] = await this.db
      .select({ id: ingestSnapshot.id })
      .from(ingestSnapshot)
      .innerJoin(ingestRun, eq(ingestRun.id, ingestSnapshot.runId))
      .where(
        and(
          eq(ingestRun.source, 'state_officials'),
          eq(ingestSnapshot.url, url),
          sql`sha2(${ingestSnapshot.body}, 256) = sha2(${body}, 256)`,
        ),
      )
      .limit(1);
    if (!same) await this.db.insert(ingestSnapshot).values({ runId: this.runId, url, body });
  }
}

/** Runs a few requests at a time. */
async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

interface TreeResponse {
  sha: string;
  truncated?: boolean;
  tree: { path: string; type: string }[];
}

/**
 * Reads the governors of the given states from openstates/people. Returns, per state,
 * the governor and the file they came from, or a problem.
 */
async function readGovernors(
  fetcher: Fetcher,
  opts: StateOfficialsOptions,
  states: string[],
  today: string,
) {
  const api = opts.githubApi ?? GITHUB_API;
  const raw = opts.githubRaw ?? GITHUB_RAW;
  const headers: Record<string, string> = opts.githubToken
    ? { authorization: `Bearer ${opts.githubToken}` }
    : {};
  // The directory listing is large and only says which files exist, so it is not kept.
  const tree = JSON.parse(
    await fetcher.get(
      `${api}/repos/${OPENSTATES_PEOPLE_REPO}/git/trees/main?recursive=1`,
      'application/vnd.github+json',
      headers,
      false,
    ),
  ) as TreeResponse;
  if (tree.truncated) throw new Error('The openstates/people file list came back incomplete.');
  const wanted = new Set(states.map((s) => s.toLowerCase()));
  const files = tree.tree
    .filter((t) => t.type === 'blob')
    .map((t) => ({ path: t.path, m: /^data\/([a-z]{2})\/executive\/[^/]+\.ya?ml$/.exec(t.path) }))
    .filter((f): f is { path: string; m: RegExpExecArray } => !!f.m && wanted.has(f.m[1]!));
  const found = new Map<string, { official: StateOfficial; path: string }[]>();
  // Read at the listed commit, so every file comes from the same version of the repository.
  await inBatches(files, 8, async ({ path, m }) => {
    const state = m[1]!.toUpperCase();
    const text = await fetcher.get(
      `${raw}/${OPENSTATES_PEOPLE_REPO}/${tree.sha}/${path}`,
      'text/plain',
    );
    const official = governorFromFile(state, text, today);
    if (official) found.set(state, [...(found.get(state) ?? []), { official, path }]);
  });
  type Outcome = { ok: { official: StateOfficial; path: string } } | { problem: string };
  return new Map<string, Outcome>(
    states.map((state): [string, Outcome] => {
      const list = found.get(state) ?? [];
      if (list.length === 1) return [state, { ok: list[0]! }];
      return [
        state,
        {
          problem:
            list.length === 0
              ? 'Open States lists no governor whose term includes today. The governor shown before, if any, is kept until it does.'
              : `Open States lists ${list.length} governors in office today (${list.map((g) => g.official.name).join(', ')}). Nothing was changed.`,
        },
      ];
    }),
  );
}

type Row = typeof stateOfficeholder.$inferSelect;
const FIELDS = [
  'district',
  'name',
  'sortName',
  'partyName',
  'officialUrl',
  'termStart',
  'termEnd',
] as const;

/**
 * Brings one state's rows for the given roles in line with a fresh list: new people are
 * added, changes are written, everyone listed is marked seen today, and anyone no longer
 * listed is marked as having left.
 */
async function applyState(
  tx: Tx,
  state: string,
  roles: StateOfficeRole[],
  fresh: StateOfficial[],
  sourceId: number,
  today: string,
) {
  const current = await tx
    .select()
    .from(stateOfficeholder)
    .where(and(eq(stateOfficeholder.state, state), inArray(stateOfficeholder.role, roles)));
  const key = (r: { osPersonId: string; role: string }) => `${r.osPersonId}|${r.role}`;
  const byKey = new Map<string, Row>(current.map((r) => [key(r), r]));
  const counts = { added: 0, updated: 0, left: 0 };
  const touched: number[] = [];
  const inserts: (typeof stateOfficeholder.$inferInsert)[] = [];
  for (const f of fresh) {
    const row = byKey.get(key(f));
    byKey.delete(key(f));
    if (!row) {
      inserts.push({ ...f, sourceId, firstSeenOn: today, lastSeenOn: today });
      counts.added++;
      continue;
    }
    const changed = FIELDS.some((k) => (row[k] ?? null) !== (f[k] ?? null));
    if (changed || row.leftOn || row.sourceId !== sourceId) {
      await tx
        .update(stateOfficeholder)
        .set({
          ...Object.fromEntries(FIELDS.map((k) => [k, f[k]])),
          sourceId,
          lastSeenOn: today,
          leftOn: null,
        })
        .where(eq(stateOfficeholder.id, row.id));
      if (changed || row.leftOn) counts.updated++;
    } else {
      touched.push(row.id);
    }
  }
  if (inserts.length) await tx.insert(stateOfficeholder).values(inserts);
  for (let i = 0; i < touched.length; i += 500) {
    await tx
      .update(stateOfficeholder)
      .set({ lastSeenOn: today })
      .where(inArray(stateOfficeholder.id, touched.slice(i, i + 500)));
  }
  const gone = [...byKey.values()].filter((r) => !r.leftOn).map((r) => r.id);
  if (gone.length) {
    await tx
      .update(stateOfficeholder)
      .set({ leftOn: today })
      .where(inArray(stateOfficeholder.id, gone));
    counts.left = gone.length;
  }
  return counts;
}

const LEGISLATIVE: StateOfficeRole[] = ['upper', 'lower', 'legislature'];

/** Imports governors and legislators for each state. A state that fails is skipped, not emptied. */
export async function runStateOfficialsImport(
  db: Db,
  opts: StateOfficialsOptions = {},
): Promise<{ runId: number; summary: StateOfficialsSummary }> {
  const states = opts.states ?? STATE_OFFICIAL_STATES;
  const today = opts.today ?? todayUtc();
  const actor = await systemActor(db, OPENSTATES_ACCOUNT);
  const [run] = await db.insert(ingestRun).values({
    source: 'state_officials',
    params: { states },
    startedBy: opts.startedBy ?? null,
  });
  const runId = run.insertId;
  const fetcher = new Fetcher(opts, db, runId);
  const summary: StateOfficialsSummary = {
    requests: 0,
    states: states.map((state) => ({
      state,
      governor: null,
      legislators: 0,
      added: 0,
      updated: 0,
      left: 0,
      refreshed: false,
    })),
    attention: [],
  };
  const flag = (state: string, problem: string) => summary.attention.push({ state, problem });
  try {
    let governors: Awaited<ReturnType<typeof readGovernors>> | null = null;
    try {
      governors = await readGovernors(fetcher, opts, states, today);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      flag('—', `Governors were not read, so none changed: ${message}`);
    }

    for (const s of summary.states) {
      let refreshedGov = false;
      const g = governors?.get(s.state);
      if (g && 'ok' in g) {
        const { official, path } = g.ok;
        const counts = await db.transaction(async (tx) => {
          const sourceId = await ensureImportSource(
            tx,
            actor,
            {
              url: `https://github.com/${OPENSTATES_PEOPLE_REPO}/blob/main/${path}`,
              title: `${official.name}, Governor of ${stateNameFor(s.state)} (Open States)`,
              publisher: 'Open States',
              sourceType: 'reference',
            },
            today,
          );
          return applyState(tx, s.state, ['governor'], [official], sourceId, today);
        });
        s.governor = official.name;
        s.added += counts.added;
        s.updated += counts.updated;
        s.left += counts.left;
        refreshedGov = true;
      } else if (g) {
        flag(s.state, g.problem);
      }

      const url = `${opts.csvBase ?? STATE_OFFICIALS_CSV_BASE}/${s.state.toLowerCase()}.csv`;
      let fresh: StateOfficial[];
      try {
        fresh = parseLegislatorCsv(s.state, await fetcher.get(url, 'text/csv'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        flag(s.state, `Legislators were not read, so none changed: ${message}`);
        continue;
      }
      const [listed] = await db
        .select({ n: sql<number>`count(*)` })
        .from(stateOfficeholder)
        .where(
          and(
            eq(stateOfficeholder.state, s.state),
            inArray(stateOfficeholder.role, LEGISLATIVE),
            isNull(stateOfficeholder.leftOn),
          ),
        );
      const before = Number(listed?.n ?? 0);
      if (fresh.length === 0 || fresh.length < before * MIN_LEGISLATOR_SHARE) {
        flag(
          s.state,
          `Open States lists ${fresh.length} legislators, against ${before} listed now. That looks wrong, so nothing was changed; check ${url}.`,
        );
        continue;
      }
      const counts = await db.transaction(async (tx) => {
        const sourceId = await ensureImportSource(
          tx,
          actor,
          {
            url,
            title: `${stateNameFor(s.state)} legislators in office (Open States)`,
            publisher: 'Open States',
            sourceType: 'reference',
          },
          today,
        );
        return applyState(tx, s.state, LEGISLATIVE, fresh, sourceId, today);
      });
      s.legislators = fresh.length;
      s.added += counts.added;
      s.updated += counts.updated;
      s.left += counts.left;
      s.refreshed = refreshedGov;
    }

    summary.requests = fetcher.requests;
    await db
      .update(ingestRun)
      .set({ state: 'succeeded', finishedAt: new Date(), summary })
      .where(eq(ingestRun.id, runId));
    return { runId, summary };
  } catch (error) {
    summary.requests = fetcher.requests;
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRun)
      .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}

// ---------------------------------------------------------------------------------
// Public reads

/** Imported records are public until an editor takes one down. */
const shown = notInArray(stateOfficeholder.publishState, ['unpublished', 'archived']);

export const STATE_OFFICIAL_SEARCH_LIMIT = 200;

export interface StateOfficialFilters {
  q?: string;
  /** USPS code. */
  state?: string;
  role?: StateOfficeRole;
  party?: string;
}

export interface StateOfficialView {
  id: number;
  osPersonId: string;
  state: string;
  role: StateOfficeRole;
  district: string | null;
  name: string;
  partyName: string | null;
  officialUrl: string | null;
  termStart: string | null;
  termEnd: string | null;
  lastSeenOn: string;
  sourceUrl: string;
  /** A published CivicScope profile carrying this Open States ID, if there is one. */
  personSlug: string | null;
  /** The photo on that profile, if it has one. */
  photoId: number | null;
}

export interface StateCoverageRow {
  state: string;
  governor: number;
  legislators: number;
  /** The oldest "last seen" date among this state's listed officials. */
  verifiedOn: string | null;
}

/**
 * Governors and state legislators in office. Without a state or name, only governors
 * are returned (all 50 legislatures at once would be some 7,000 names); a name search
 * is capped at STATE_OFFICIAL_SEARCH_LIMIT.
 */
export async function listStateOfficials(db: Db, filters: StateOfficialFilters = {}) {
  const q = filters.q?.trim().slice(0, 100);
  const state = filters.state?.toUpperCase();
  const narrowed = Boolean(q || state);
  const role = filters.role ?? (narrowed ? undefined : 'governor');
  const listed = and(isNull(stateOfficeholder.leftOn), shown)!;
  const rows = await db
    .select({
      id: stateOfficeholder.id,
      osPersonId: stateOfficeholder.osPersonId,
      state: stateOfficeholder.state,
      role: stateOfficeholder.role,
      district: stateOfficeholder.district,
      name: stateOfficeholder.name,
      sortName: stateOfficeholder.sortName,
      partyName: stateOfficeholder.partyName,
      officialUrl: stateOfficeholder.officialUrl,
      termStart: stateOfficeholder.termStart,
      termEnd: stateOfficeholder.termEnd,
      lastSeenOn: stateOfficeholder.lastSeenOn,
      sourceUrl: source.url,
    })
    .from(stateOfficeholder)
    .innerJoin(source, eq(source.id, stateOfficeholder.sourceId))
    .where(
      and(
        listed,
        state ? eq(stateOfficeholder.state, state) : undefined,
        role ? eq(stateOfficeholder.role, role) : undefined,
        filters.party ? eq(stateOfficeholder.partyName, filters.party) : undefined,
        q
          ? or(
              like(stateOfficeholder.name, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
              like(stateOfficeholder.sortName, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(stateOfficeholder.state),
      asc(stateOfficeholder.sortName),
      asc(stateOfficeholder.id),
    )
    .limit(state ? 2000 : STATE_OFFICIAL_SEARCH_LIMIT + 1);
  const capped = !state && rows.length > STATE_OFFICIAL_SEARCH_LIMIT;
  const list = (capped ? rows.slice(0, STATE_OFFICIAL_SEARCH_LIMIT) : rows).slice();
  const slugs = await profileSlugs(
    db,
    list.map((r) => r.osPersonId),
  );
  const facets = await db
    .selectDistinct({ partyName: stateOfficeholder.partyName })
    .from(stateOfficeholder)
    .where(listed);
  // By state name (Alabama before Alaska), then last name.
  list.sort(
    (a, b) =>
      stateNameFor(a.state).localeCompare(stateNameFor(b.state)) ||
      a.sortName.localeCompare(b.sortName),
  );
  return {
    rows: list.map((r) => ({
      ...r,
      personSlug: slugs.get(r.osPersonId)?.slug ?? null,
      photoId: slugs.get(r.osPersonId)?.photoId ?? null,
    })) as StateOfficialView[],
    capped,
    governorsOnly: !narrowed && !filters.role,
    parties: [...new Set(facets.map((f) => f.partyName).filter((p): p is string => !!p))].sort(),
  };
}

/** What is listed for each state, for the page's coverage note. */
export async function stateOfficialsCoverage(db: Db): Promise<StateCoverageRow[]> {
  const rows = await db
    .select({
      state: stateOfficeholder.state,
      governor: sql<number>`coalesce(sum(${stateOfficeholder.role} = 'governor'), 0)`,
      legislators: sql<number>`coalesce(sum(${stateOfficeholder.role} <> 'governor'), 0)`,
      verifiedOn: sql<string | null>`min(${stateOfficeholder.lastSeenOn})`,
    })
    .from(stateOfficeholder)
    .where(and(isNull(stateOfficeholder.leftOn), shown))
    .groupBy(stateOfficeholder.state);
  const byState = new Map(rows.map((r) => [r.state, r]));
  return STATE_OFFICIAL_STATES.map((state) => {
    const r = byState.get(state);
    return {
      state,
      governor: Number(r?.governor ?? 0),
      legislators: Number(r?.legislators ?? 0),
      verifiedOn: r?.verifiedOn ? String(r.verifiedOn).slice(0, 10) : null,
    };
  });
}

/** One officeholder's public page: their current and past state offices here. */
export async function getStateOfficial(db: Db, osPersonId: string) {
  const rows = await db
    .select({
      id: stateOfficeholder.id,
      osPersonId: stateOfficeholder.osPersonId,
      state: stateOfficeholder.state,
      role: stateOfficeholder.role,
      district: stateOfficeholder.district,
      name: stateOfficeholder.name,
      partyName: stateOfficeholder.partyName,
      officialUrl: stateOfficeholder.officialUrl,
      termStart: stateOfficeholder.termStart,
      termEnd: stateOfficeholder.termEnd,
      firstSeenOn: stateOfficeholder.firstSeenOn,
      lastSeenOn: stateOfficeholder.lastSeenOn,
      leftOn: stateOfficeholder.leftOn,
      sourceUrl: source.url,
      sourceRetrievedAt: source.retrievedAt,
    })
    .from(stateOfficeholder)
    .innerJoin(source, eq(source.id, stateOfficeholder.sourceId))
    .where(and(eq(stateOfficeholder.osPersonId, osPersonId), shown))
    .orderBy(sql`${stateOfficeholder.leftOn} is not null`, desc(stateOfficeholder.lastSeenOn));
  if (!rows.length) return null;
  const profile = (await profileSlugs(db, [osPersonId])).get(osPersonId);
  return {
    offices: rows,
    personSlug: profile?.slug ?? null,
    photoId: profile?.photoId ?? null,
  };
}

async function profileSlugs(db: Db, ids: string[]) {
  const unique = [...new Set(ids)];
  const out = new Map<string, { slug: string; photoId: number | null }>();
  if (!unique.length) return out;
  for (let i = 0; i < unique.length; i += 1000) {
    const people = await db
      .select({ value: personIdentifier.value, slug: person.slug, photoId: person.photoId })
      .from(personIdentifier)
      .innerJoin(person, eq(person.id, personIdentifier.personId))
      .where(
        and(
          eq(personIdentifier.scheme, 'openstates'),
          inArray(personIdentifier.value, unique.slice(i, i + 1000)),
          isNull(person.deletedAt),
          eq(person.publishState, 'published'),
        ),
      );
    for (const p of people) out.set(p.value, { slug: p.slug, photoId: p.photoId });
  }
  return out;
}

/** "ocd-person/<uuid>" -> "<uuid>", for URLs. */
export const stateOfficialSlug = (osPersonId: string) => osPersonId.replace(/^ocd-person\//, '');
