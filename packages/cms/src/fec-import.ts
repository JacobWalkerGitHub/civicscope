import { and, count, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  fecCandidateListUrl,
  fecCandidatePageSchema,
  fecIdState,
  fecSortName,
  formatFecName,
  generalElectionDate,
  toCsvLine,
  type FecCandidate,
} from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { recordChange, type Actor } from './changes';
import { createElection, createRace } from './elections';
import { applyImport, planCandidateImport, type RowAction } from './imports';
import { createOffice } from './offices';

const {
  adminUser,
  district,
  election,
  importBatch,
  ingestRun,
  ingestSnapshot,
  jurisdiction,
  office,
  party,
  race,
  source,
} = schema;

export const FEC_API_BASE = 'https://api.open.fec.gov';

/** The admin account that automated imports act as. It can never sign in. */
const SYSTEM_EMAIL = 'fec-import@system.civicscope.invalid';

export async function systemActor(db: Db): Promise<Actor> {
  const [found] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.email, SYSTEM_EMAIL));
  if (found) return { userId: found.id, ipAddress: null };
  const [res] = await db.insert(adminUser).values({
    email: SYSTEM_EMAIL,
    name: 'Automated import (FEC)',
    // Not a valid hash of anything, and the account is disabled, so no one can sign in as it.
    passwordHash: '!',
    role: 'editor',
    disabledAt: new Date(),
  });
  await recordAudit(db, {
    actorType: 'system',
    actorId: 'fec-import',
    action: 'create',
    entityType: 'admin_user',
    entityId: String(res.insertId),
    diff: { email: [null, SYSTEM_EMAIL] },
    note: 'Account for automated FEC imports (disabled; cannot sign in)',
    ipAddress: null,
  });
  return { userId: res.insertId, ipAddress: null };
}

// ---------------------------------------------------------------------------------
// Fetching

export interface FecFetchOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  maxPages?: number;
}

const withoutKey = (url: URL) => {
  const copy = new URL(url);
  copy.searchParams.delete('api_key');
  return copy.toString();
};

async function fetchPage(url: URL, opts: FecFetchOptions): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (res.ok) return res.text();
    lastError = `HTTP ${res.status}`;
    // Rate limits and server errors are worth retrying; anything else is not.
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`Could not fetch ${withoutKey(url)}: ${lastError}`);
}

/**
 * Every statutory candidate (raised or spent over $5,000) registered for one
 * election year, for President, Senate and House, page by page.
 */
export async function* fetchFecCandidates(cycle: number, opts: FecFetchOptions) {
  const maxPages = opts.maxPages ?? 200;
  for (let page = 1; ; page++) {
    const url = new URL('/v1/candidates/', opts.baseUrl ?? FEC_API_BASE);
    url.searchParams.set('election_year', String(cycle));
    for (const o of ['P', 'S', 'H']) url.searchParams.append('office', o);
    url.searchParams.set('candidate_status', 'C');
    url.searchParams.set('sort', 'candidate_id');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('api_key', opts.apiKey);
    const body = await fetchPage(url, opts);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`Page ${page} from the FEC is not JSON.`);
    }
    const parsed = fecCandidatePageSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `Page ${page} from the FEC is not in the expected format (${issue?.path.join('.')}: ${issue?.message}). Nothing was imported from it.`,
      );
    }
    yield { url: withoutKey(url), body, page: parsed.data };
    if (page >= parsed.data.pagination.pages) return;
    if (page >= maxPages)
      throw new Error(`Stopped after ${maxPages} pages; that is more than expected.`);
  }
}

// ---------------------------------------------------------------------------------
// Where each candidate goes

interface RaceKey {
  office: 'H' | 'S' | 'P';
  state: string;
  /** For House seats only; null when at-large. */
  district: number | null;
}

const keyOf = (c: FecCandidate): RaceKey => {
  const d = c.office === 'H' && c.district ? Number(c.district) : 0;
  return { office: c.office, state: c.office === 'P' ? 'US' : c.state, district: d || null };
};
const keyString = (k: RaceKey) => `${k.office}-${k.state}-${k.district ?? 0}`;

const OFFICES = {
  P: { title: 'President of the United States', branch: 'executive', chamber: '', termYears: 4 },
  S: { title: 'U.S. Senator', branch: 'legislative', chamber: 'upper', termYears: 6 },
  H: { title: 'U.S. Representative', branch: 'legislative', chamber: 'lower', termYears: 2 },
} as const;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Finds or creates the general-election race a candidate's registration points to.
 * Anything created starts as a draft. Returns null for places CivicScope doesn't
 * model yet (territories' delegates).
 */
async function ensureRace(
  db: Db,
  actor: Actor,
  key: RaceKey,
  cycle: number,
): Promise<{ raceId: number; name: string } | { skip: string }> {
  const [place] = await db
    .select()
    .from(jurisdiction)
    .where(
      key.office === 'P' ? eq(jurisdiction.type, 'country') : eq(jurisdiction.uspsCode, key.state),
    );
  if (!place || place.deletedAt) {
    return { skip: `CivicScope doesn’t cover ${key.state} yet (territories are not loaded).` };
  }
  if (key.office !== 'P' && place.type !== 'state') {
    // D.C. elects no senators and sends a non-voting delegate, not a Representative.
    return { skip: `${place.name} has no U.S. Senate or voting House seat to import into.` };
  }
  const date = generalElectionDate(cycle);

  let [electionRow] = await db
    .select()
    .from(election)
    .where(
      and(
        eq(election.jurisdictionId, place.id),
        eq(election.type, 'general'),
        eq(election.date, date),
      ),
    );
  if (!electionRow) {
    const id = await createElection(db, actor, {
      jurisdictionId: place.id,
      type: 'general',
      primarySystem: 'not_applicable',
      date,
      name:
        key.office === 'P'
          ? `${cycle} presidential election`
          : `${place.name} general election, ${cycle}`,
    });
    [electionRow] = await db.select().from(election).where(eq(election.id, id));
  }
  if (electionRow!.deletedAt) return { skip: `The election “${electionRow!.name}” is archived.` };

  const spec = OFFICES[key.office];
  let [officeRow] = await db
    .select()
    .from(office)
    .where(
      and(
        eq(office.jurisdictionId, place.id),
        eq(office.title, spec.title),
        isNull(office.deletedAt),
      ),
    );
  if (!officeRow) {
    const id = await createOffice(db, actor, {
      jurisdictionId: place.id,
      title: spec.title,
      level: 'federal',
      branch: spec.branch,
      chamber: spec.chamber,
      seats: 1,
      termYears: spec.termYears,
      isPartisan: 'on',
    });
    [officeRow] = await db.select().from(office).where(eq(office.id, id));
  }

  let districtId: number | null = null;
  let districtLabel = '';
  if (key.office === 'H' && key.district) {
    const ocdId = `${place.ocdId}/cd:${key.district}`;
    const [found] = await db
      .select()
      .from(district)
      .where(
        and(
          eq(district.ocdId, ocdId),
          lte(district.validFrom, date),
          or(isNull(district.validTo), gt(district.validTo, date)),
          isNull(district.deletedAt),
        ),
      );
    districtLabel = String(key.district);
    if (found) {
      districtId = found.id;
    } else {
      // The FEC says which district, not which map drew it, so this version is dated
      // from the start of the election year until an editor records the plan.
      const [res] = await db.insert(district).values({
        jurisdictionId: place.id,
        type: 'congressional',
        label: districtLabel,
        name: `${place.name}’s ${ordinal(key.district)} congressional district`,
        ocdId,
        validFrom: `${cycle}-01-01`,
      });
      districtId = res.insertId;
      const [created] = await db.select().from(district).where(eq(district.id, districtId));
      await db.transaction((tx) =>
        recordChange(tx, actor, {
          entityType: 'district',
          entityId: districtId!,
          action: 'create',
          before: null,
          after: created!,
          note: 'Created by the FEC import',
        }),
      );
    }
  }

  const name =
    key.office === 'P'
      ? 'President of the United States'
      : key.office === 'S'
        ? `U.S. Senate, ${place.name}`
        : `U.S. House, ${place.name} ${key.district ? `District ${districtLabel}` : 'At-Large'}`;
  const [existing] = await db
    .select()
    .from(race)
    .where(
      and(
        eq(race.electionId, electionRow!.id),
        eq(race.officeId, officeRow!.id),
        districtId ? eq(race.districtId, districtId) : isNull(race.districtId),
        isNull(race.partyId),
        eq(race.isSpecial, false),
      ),
    );
  if (existing) {
    if (existing.deletedAt) return { skip: `The race “${existing.name}” is archived.` };
    return { raceId: existing.id, name: existing.name };
  }
  const raceId = await createRace(db, actor, {
    electionId: electionRow!.id,
    officeId: officeRow!.id,
    districtId: districtId ?? '',
    name,
  });
  return { raceId, name };
}

// ---------------------------------------------------------------------------------
// Running

export interface FecAttention {
  fecId: string;
  name: string;
  race: string;
  problem: string;
}

export interface FecRunSummary {
  fetched: number;
  skippedInactive: number;
  races: number;
  racesChanged: number;
  counts: Record<RowAction, number> & { conflicts: number };
  unknownPartyCodes: string[];
  attention: FecAttention[];
}

const IMPORT_COLUMNS = [
  'full_name',
  'sort_name',
  'party',
  'incumbent',
  'status',
  'status_date',
  'fec_candidate_id',
] as const;

/**
 * Imports one election year's FEC registrations. For each race: works out what would
 * change, applies the safe part as the automated account, and lists what a person
 * must decide (possible duplicates, archived records). Locked fields open conflicts
 * instead of changing. Running it twice in a row changes nothing the second time.
 */
export async function runFecImport(
  db: Db,
  cycle: number,
  opts: FecFetchOptions & { startedBy?: number | null; today?: string },
): Promise<{ runId: number; summary: FecRunSummary }> {
  const actor = await systemActor(db);
  const [run] = await db
    .insert(ingestRun)
    .values({ source: 'fec', params: { cycle }, startedBy: opts.startedBy ?? null });
  const runId = run.insertId;
  const summary: FecRunSummary = {
    fetched: 0,
    skippedInactive: 0,
    races: 0,
    racesChanged: 0,
    counts: { create: 0, add_to_race: 0, update: 0, unchanged: 0, error: 0, conflicts: 0 },
    unknownPartyCodes: [],
    attention: [],
  };
  try {
    const candidates: FecCandidate[] = [];
    for await (const { url, body, page } of fetchFecCandidates(cycle, opts)) {
      await db.insert(ingestSnapshot).values({ runId, url, body });
      candidates.push(...page.results);
    }
    summary.fetched = candidates.length;

    const partyByCode = new Map(
      (await db.select().from(party).where(isNull(party.deletedAt)))
        .filter((p) => p.fecCode)
        .map((p) => [p.fecCode!, p.fecCode!]),
    );
    const unknownCodes = new Set<string>();
    const groups = new Map<string, { key: RaceKey; rows: FecCandidate[] }>();
    const seenIds = new Set<string>();
    for (const c of candidates) {
      if (c.candidate_inactive || (c.candidate_status && c.candidate_status !== 'C')) {
        summary.skippedInactive++;
        continue;
      }
      if (seenIds.has(c.candidate_id)) continue;
      seenIds.add(c.candidate_id);
      // Senate and House IDs are issued for one state. When the registration names
      // another (S6MD03441 was listed under DC for 2028), a person decides which is right.
      const idState = fecIdState(c.candidate_id);
      if (idState && idState !== c.state) {
        summary.attention.push({
          fecId: c.candidate_id,
          name: formatFecName(c.name),
          race: `${c.office} ${c.state}`,
          problem: `The FEC lists this registration under ${c.state}, but the candidate ID was issued for ${idState}. Check which state is right and add the candidate by hand.`,
        });
        continue;
      }
      const key = keyOf(c);
      const k = keyString(key);
      groups.set(k, { key, rows: [...(groups.get(k)?.rows ?? []), c] });
    }

    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    for (const { key, rows } of [...groups.values()].sort((a, b) =>
      keyString(a.key).localeCompare(keyString(b.key)),
    )) {
      const target = await ensureRace(db, actor, key, cycle);
      if ('skip' in target) {
        for (const c of rows) {
          summary.attention.push({
            fecId: c.candidate_id,
            name: formatFecName(c.name),
            race: `${key.office} ${key.state}`,
            problem: target.skip,
          });
        }
        continue;
      }
      summary.races++;

      const lines = rows.map((c) => {
        const code = c.party?.trim().toUpperCase() || null;
        if (code && !partyByCode.has(code)) unknownCodes.add(code);
        const date = c.first_file_date && c.first_file_date <= today ? c.first_file_date : null;
        return {
          c,
          cells: [
            formatFecName(c.name),
            fecSortName(c.name),
            code && partyByCode.has(code) ? code : '',
            c.incumbent_challenge === 'I' ? 'yes' : 'no',
            date ? 'registered' : '',
            date ?? '',
            c.candidate_id,
          ],
        };
      });
      const csv = (keep: (i: number) => boolean) =>
        [
          toCsvLine(IMPORT_COLUMNS),
          ...lines.filter((_, i) => keep(i)).map((l) => toCsvLine(l.cells)),
        ]
          .join('\n')
          .concat('\n');

      // Plan first without writing anything, then apply only rows that can go in safely.
      const plan = await planCandidateImport(db, {
        csvText: csv(() => true),
        raceId: target.raceId,
      });
      const ok = new Set<number>();
      plan.rows.forEach((r, i) => {
        if (r.action === 'error') {
          summary.counts.error++;
          summary.attention.push({
            fecId: lines[i]!.c.candidate_id,
            name: r.name,
            race: target.name,
            problem: r.errors.join(' '),
          });
        } else if (r.action === 'unchanged') {
          summary.counts.unchanged++;
        } else {
          ok.add(i);
        }
      });
      const src = fecCandidateListUrl({
        office: key.office,
        cycle,
        state: key.state,
        district: key.district ? String(key.district).padStart(2, '0') : null,
      });
      if (ok.size === 0) {
        // Nothing to change: just record that the source was checked today.
        await db.update(source).set({ retrievedAt: today }).where(eq(source.url, src));
        continue;
      }
      const [res] = await db.insert(importBatch).values({
        kind: 'fec',
        raceId: target.raceId,
        fileName: `FEC ${cycle} ${target.name}`.slice(0, 255),
        csvText: csv((i) => ok.has(i)),
        sourceRef: {
          sourceUrl: src,
          sourceTitle: `FEC candidate list: ${target.name}, ${cycle}`,
          sourcePublisher: 'Federal Election Commission',
          sourceType: 'government_record',
          sourcePublishedAt: null,
        },
        createdBy: actor.userId,
        ingestRunId: runId,
      });
      const applied = await applyImport(db, actor, res.insertId);
      summary.racesChanged++;
      for (const action of ['create', 'add_to_race', 'update', 'unchanged'] as const) {
        summary.counts[action] += applied[action];
      }
      summary.counts.conflicts += applied.conflicts;
    }
    summary.unknownPartyCodes = [...unknownCodes].sort();
    await db
      .update(ingestRun)
      .set({ state: 'succeeded', finishedAt: new Date(), summary })
      .where(eq(ingestRun.id, runId));
    return { runId, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRun)
      .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}

export async function listIngestRuns(db: Db, limit = 50) {
  return db
    .select({
      id: ingestRun.id,
      source: ingestRun.source,
      params: ingestRun.params,
      state: ingestRun.state,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      summary: ingestRun.summary,
      error: ingestRun.error,
    })
    .from(ingestRun)
    .orderBy(desc(ingestRun.startedAt), desc(ingestRun.id))
    .limit(limit);
}

export async function getIngestRun(db: Db, id: number) {
  const [row] = await db.select().from(ingestRun).where(eq(ingestRun.id, id));
  if (!row) return null;
  const batches = await db
    .select({
      id: importBatch.id,
      raceId: importBatch.raceId,
      fileName: importBatch.fileName,
      summary: importBatch.summary,
      raceName: race.name,
    })
    .from(importBatch)
    .innerJoin(race, eq(race.id, importBatch.raceId))
    .where(eq(importBatch.ingestRunId, id))
    .orderBy(importBatch.id);
  const [snapshots] = await db
    .select({ pages: count() })
    .from(ingestSnapshot)
    .where(eq(ingestSnapshot.runId, id));
  return { run: row, batches, pages: snapshots?.pages ?? 0 };
}
