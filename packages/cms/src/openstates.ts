import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { PersonIdentifierScheme } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { insertCitation } from './citations';
import {
  ensureImportSource,
  fetchText,
  OPENSTATES_ACCOUNT,
  systemActor,
  todayUtc,
  type FetchOptions,
} from './ingest-common';
import { uniqueSlug } from './slugs';

const {
  candidacy,
  ingestRun,
  ingestSnapshot,
  jurisdiction,
  office,
  person,
  personIdentifier,
  race,
  stateBill,
  stateVote,
  stateVoteCursor,
  stateVotePosition,
} = schema;

/*
 * State legislative votes from Open States (v3.openstates.org), which reads each
 * legislature's own site. Two steps per state:
 *   1. The crosswalk: every sitting legislator is matched to a CivicScope person by
 *      their Open States ID, or by name to a candidate in the same state, or becomes a
 *      new draft person. Unclear matches are listed for an editor, never guessed.
 *   2. Bills with floor or committee votes, read oldest change first from where the
 *      last run stopped, with every legislator's vote.
 * The free API allows few requests, so calls are spaced out and each run has a budget;
 * the next run continues where this one stopped.
 */

export const OPENSTATES_BASE = 'https://v3.openstates.org';
export const OPENSTATES_SITE = 'https://openstates.org';
/** The states whose legislatures are on the 2027 ballot. */
export const OPENSTATES_STATES = ['VA', 'NJ', 'LA', 'MS'];
/** Bills with any action since this date are read: the current terms' sessions. */
export const OPENSTATES_ACTION_SINCE = '2025-01-01';
export const OPENSTATES_MAX_REQUESTS = 300;
/** Milliseconds between requests: about eight a minute. */
export const OPENSTATES_SPACING = 7_500;

const jurisdictionId = (state: string) =>
  `ocd-jurisdiction/country:us/state:${state.toLowerCase()}/government`;

interface OsPerson {
  id: string;
  name: string;
  party?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  openstates_url?: string | null;
  current_role?: {
    title?: string | null;
    org_classification?: string | null;
    district?: string | number | null;
  } | null;
}

interface OsVote {
  id: string;
  motion_text?: string | null;
  start_date: string;
  result?: string | null;
  organization?: { classification?: string | null } | null;
  votes?: { option: string; voter_name: string; voter?: { id?: string | null } | null }[];
  counts?: { option: string; value: number }[];
  sources?: { url: string }[];
}

interface OsBill {
  id: string;
  session: string;
  identifier: string;
  title: string;
  updated_at: string;
  latest_action_date?: string | null;
  latest_action_description?: string | null;
  openstates_url?: string | null;
  votes?: OsVote[];
}

interface OsPage<T> {
  results: T[];
  pagination: { page: number; max_page: number; total_items: number };
}

export interface OpenStatesAttention {
  openstatesId: string;
  name: string;
  problem: string;
}

export interface OpenStatesStateSummary {
  state: string;
  legislators: number;
  billPages: number;
  billsWithVotes: number;
  votes: number;
  /** True once the bill listing was read to its end this run. */
  caughtUp: boolean;
}

export interface OpenStatesSummary {
  requests: number;
  created: number;
  linked: number;
  unchanged: number;
  states: OpenStatesStateSummary[];
  attention: OpenStatesAttention[];
}

export interface OpenStatesOptions extends FetchOptions {
  apiKey: string;
  states?: string[];
  maxRequests?: number;
  spacing?: number;
  baseUrl?: string;
  startedBy?: number | null;
  today?: string;
}

/** Lowercased, without accents, punctuation or suffixes, for matching names. */
export const osNameKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "yes"/"no" counts and everything else, from a vote's tallies. */
export function voteCounts(v: OsVote) {
  let yes = 0;
  let no = 0;
  let other = 0;
  for (const c of v.counts ?? []) {
    const n = Number(c.value) || 0;
    if (c.option === 'yes') yes += n;
    else if (c.option === 'no') no += n;
    else other += n;
  }
  return { yes, no, other };
}

const chamberOf = (v: OsVote): 'upper' | 'lower' | 'legislature' => {
  const c = v.organization?.classification;
  return c === 'upper' || c === 'lower' ? c : 'legislature';
};

async function addIdentifier(
  tx: Tx,
  actor: Actor,
  personId: number,
  id: { scheme: PersonIdentifierScheme; value: string },
  note: string,
) {
  const [res] = await tx.insert(personIdentifier).values({ personId, ...id });
  const [row] = await tx
    .select()
    .from(personIdentifier)
    .where(eq(personIdentifier.id, res.insertId));
  await recordChange(tx, actor, {
    entityType: 'person_identifier',
    entityId: res.insertId,
    action: 'create',
    before: null,
    after: row!,
    note,
  });
}

class Client {
  requests = 0;
  /** Request count at which the current state's share of the budget ends. */
  stopAt = Infinity;
  constructor(
    private readonly opts: OpenStatesOptions,
    private readonly db: Db,
    private readonly runId: number,
  ) {}

  get left() {
    const max = Math.min(this.opts.maxRequests ?? OPENSTATES_MAX_REQUESTS, this.stopAt);
    return max - this.requests;
  }

  async get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    if (this.left <= 0) throw new Error('Open States request budget spent.');
    const sleep = this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    if (this.requests > 0) await sleep(this.opts.spacing ?? OPENSTATES_SPACING);
    this.requests++;
    const url = new URL(path, this.opts.baseUrl ?? OPENSTATES_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    // The key goes in a header, so the URL is safe to store.
    const body = await fetchText(url, this.opts, 'application/json', {
      'x-api-key': this.opts.apiKey,
    });
    let json: T;
    try {
      json = JSON.parse(body) as T;
    } catch {
      throw new Error(`${url.pathname} did not return JSON.`);
    }
    await this.db.insert(ingestSnapshot).values({ runId: this.runId, url: url.toString(), body });
    return json;
  }
}

/** Every page of a listing, while the budget lasts. */
async function allPages<T>(client: Client, path: string, params: Record<string, string | number>) {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await client.get<OsPage<T>>(path, { ...params, page });
    out.push(...res.results);
    if (page >= res.pagination.max_page || res.results.length === 0) return out;
  }
}

async function crosswalk(
  db: Db,
  actor: Actor,
  state: string,
  legislators: OsPerson[],
  summary: OpenStatesSummary,
  today: string,
) {
  const owners = new Map(
    (
      await db
        .select({ value: personIdentifier.value, personId: personIdentifier.personId })
        .from(personIdentifier)
        .where(eq(personIdentifier.scheme, 'openstates'))
    ).map((r) => [r.value, r.personId] as const),
  );
  const linked = new Set(owners.values());
  const people = await db
    .select({ id: person.id, fullName: person.fullName })
    .from(person)
    .where(isNull(person.deletedAt));
  const byName = new Map<string, number[]>();
  for (const p of people) {
    if (linked.has(p.id)) continue;
    const k = osNameKey(p.fullName);
    byName.set(k, [...(byName.get(k) ?? []), p.id]);
  }
  const names = new Map(people.map((p) => [p.id, p.fullName] as const));
  // People already running for an office in this state.
  const local = new Set(
    (
      await db
        .selectDistinct({ id: candidacy.personId })
        .from(candidacy)
        .innerJoin(race, eq(race.id, candidacy.raceId))
        .innerJoin(office, eq(office.id, race.officeId))
        .innerJoin(jurisdiction, eq(jurisdiction.id, office.jurisdictionId))
        .where(eq(jurisdiction.uspsCode, state))
    ).map((r) => r.id),
  );

  for (const l of legislators) {
    if (owners.has(l.id)) {
      summary.unchanged++;
      continue;
    }
    const sameName = [
      ...new Set([
        ...(byName.get(osNameKey(l.name)) ?? []),
        ...(l.given_name && l.family_name
          ? (byName.get(osNameKey(`${l.given_name} ${l.family_name}`)) ?? [])
          : []),
      ]),
    ];
    const here = sameName.filter((id) => local.has(id));
    if (here.length === 1) {
      const personId = here[0]!;
      await db.transaction((tx) =>
        addIdentifier(
          tx,
          actor,
          personId,
          { scheme: 'openstates', value: l.id },
          `Matched by name to a ${state} candidate from Open States`,
        ),
      );
      owners.set(l.id, personId);
      summary.linked++;
      continue;
    }
    if (sameName.length) {
      const list = sameName.map((id) => `${names.get(id)} (#${id})`).join(', ');
      summary.attention.push({
        openstatesId: l.id,
        name: l.name,
        problem: `Possible match for ${list}. If it is the same person, add Open States ID ${l.id} to them and the next run links their votes.`,
      });
      continue;
    }

    const role = l.current_role;
    const seat = role?.title
      ? ` (${state} ${role.title}${role.district ? `, District ${role.district}` : ''})`
      : '';
    const personId = await db.transaction(async (tx) => {
      const slug = await uniqueSlug(tx, person, person.slug, l.name);
      const sortName = l.family_name && l.given_name ? `${l.family_name}, ${l.given_name}` : l.name;
      const [res] = await tx.insert(person).values({ fullName: l.name, sortName, slug });
      const [created] = await tx.select().from(person).where(eq(person.id, res.insertId));
      await recordChange(tx, actor, {
        entityType: 'person',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: created!,
        note: `Created from Open States${seat}`,
      });
      await addIdentifier(
        tx,
        actor,
        res.insertId,
        { scheme: 'openstates', value: l.id },
        'Added from Open States',
      );
      const src = await ensureImportSource(
        tx,
        actor,
        {
          url: l.openstates_url || `${OPENSTATES_SITE}/person/${l.id}`,
          title: `${l.name}, Open States`,
          publisher: 'Open States',
          sourceType: 'reference',
        },
        today,
      );
      await insertCitation(tx, actor, {
        sourceId: src,
        subjectType: 'person',
        subjectId: res.insertId,
        field: 'fullName',
        excerpt: null,
        locator: l.id,
      });
      return res.insertId;
    });
    owners.set(l.id, personId);
    summary.created++;
  }
}

async function storeBill(db: Db, state: string, b: OsBill) {
  const votes = (b.votes ?? []).filter((v) => v.id && v.start_date);
  if (votes.length === 0) return 0;
  await db.transaction(async (tx) => {
    const values = {
      osId: b.id,
      state,
      session: b.session.slice(0, 40),
      identifier: b.identifier.slice(0, 40),
      title: b.title.slice(0, 2000),
      latestActionOn: b.latest_action_date?.slice(0, 10) || null,
      latestActionText: b.latest_action_description?.slice(0, 1000) || null,
      openstatesUrl: b.openstates_url?.slice(0, 500) || null,
      sourceUpdatedAt: b.updated_at.slice(0, 40),
    };
    await tx
      .insert(stateBill)
      .values(values)
      .onDuplicateKeyUpdate({ set: { ...values, osId: undefined } });
    const [{ id: billId }] = (await tx
      .select({ id: stateBill.id })
      .from(stateBill)
      .where(eq(stateBill.osId, b.id))) as [{ id: number }];
    for (const v of votes) {
      const row = {
        osId: v.id,
        billId,
        chamber: chamberOf(v),
        motion: (v.motion_text || 'Vote').slice(0, 500),
        votedOn: v.start_date.slice(0, 10),
        result: (v.result || '').slice(0, 40),
        ...voteCounts(v),
        sourceUrl: v.sources?.[0]?.url?.slice(0, 1000) || null,
      };
      await tx
        .insert(stateVote)
        .values(row)
        .onDuplicateKeyUpdate({ set: { ...row, osId: undefined } });
      const [{ id: voteId }] = (await tx
        .select({ id: stateVote.id })
        .from(stateVote)
        .where(eq(stateVote.osId, v.id))) as [{ id: number }];
      await tx.delete(stateVotePosition).where(eq(stateVotePosition.voteId, voteId));
      const seen = new Set<string>();
      const positions = (v.votes ?? [])
        .map((p) => ({
          voteId,
          osPersonId: p.voter?.id || null,
          voterName: (p.voter_name || '').slice(0, 200),
          option: (p.option || 'other').slice(0, 40),
        }))
        .filter((p) => p.voterName && !seen.has(p.voterName) && seen.add(p.voterName));
      if (positions.length) await tx.insert(stateVotePosition).values(positions);
    }
  });
  return votes.length;
}

async function importBills(db: Db, client: Client, state: string, s: OpenStatesStateSummary) {
  const [saved] = await db.select().from(stateVoteCursor).where(eq(stateVoteCursor.state, state));
  let cursor = saved ?? { state, updatedSince: OPENSTATES_ACTION_SINCE, page: 1 };
  const save = async () => {
    await db
      .insert(stateVoteCursor)
      .values(cursor)
      .onDuplicateKeyUpdate({ set: { updatedSince: cursor.updatedSince, page: cursor.page } });
  };
  while (client.left > 0) {
    const res = await client.get<OsPage<OsBill>>('/bills', {
      jurisdiction: jurisdictionId(state),
      action_since: OPENSTATES_ACTION_SINCE,
      updated_since: cursor.updatedSince,
      sort: 'updated_asc',
      include: 'votes',
      per_page: 20,
      page: cursor.page,
    });
    s.billPages++;
    for (const b of res.results) {
      const n = await storeBill(db, state, b);
      if (n) {
        s.billsWithVotes++;
        s.votes += n;
      }
    }
    if (cursor.page >= res.pagination.max_page || res.results.length === 0) {
      // Read to the end. Sorted oldest change first, so the last bill is the newest;
      // the next run starts there.
      const last = res.results.at(-1)?.updated_at;
      cursor = { state, updatedSince: last ?? cursor.updatedSince, page: 1 };
      await save();
      s.caughtUp = true;
      return;
    }
    cursor = { ...cursor, page: cursor.page + 1 };
    await save();
  }
}

/**
 * Runs the crosswalk and the bill and vote import for each state, until the request
 * budget is spent. A later run picks up where this one stopped.
 */
export async function runOpenStatesImport(
  db: Db,
  opts: OpenStatesOptions,
): Promise<{ runId: number; summary: OpenStatesSummary }> {
  const states = opts.states ?? OPENSTATES_STATES;
  const today = opts.today ?? todayUtc();
  const actor = await systemActor(db, OPENSTATES_ACCOUNT);
  const [run] = await db.insert(ingestRun).values({
    source: 'openstates',
    params: { states },
    startedBy: opts.startedBy ?? null,
  });
  const runId = run.insertId;
  const client = new Client(opts, db, runId);
  const summary: OpenStatesSummary = {
    requests: 0,
    created: 0,
    linked: 0,
    unchanged: 0,
    states: states.map((state) => ({
      state,
      legislators: 0,
      billPages: 0,
      billsWithVotes: 0,
      votes: 0,
      caughtUp: false,
    })),
    attention: [],
  };
  try {
    for (const s of summary.states) {
      const legislators = await allPages<OsPerson>(client, '/people', {
        jurisdiction: jurisdictionId(s.state),
        per_page: 50,
      });
      s.legislators = legislators.length;
      await crosswalk(db, actor, s.state, legislators, summary, today);
    }
    // Share what is left of the budget between the states.
    for (const [i, s] of summary.states.entries()) {
      client.stopAt = Infinity;
      client.stopAt = client.requests + Math.floor(client.left / (summary.states.length - i));
      await importBills(db, client, s.state, s);
    }
    client.stopAt = Infinity;
    summary.requests = client.requests;
    await db
      .update(ingestRun)
      .set({ state: 'succeeded', finishedAt: new Date(), summary })
      .where(eq(ingestRun.id, runId));
    return { runId, summary };
  } catch (error) {
    summary.requests = client.requests;
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRun)
      .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}

export interface StateVoteView {
  voteId: number;
  votedOn: string;
  chamber: 'upper' | 'lower' | 'legislature';
  motion: string;
  result: string;
  yes: number;
  no: number;
  other: number;
  option: string;
  sourceUrl: string | null;
  bill: {
    state: string;
    session: string;
    identifier: string;
    title: string;
    openstatesUrl: string | null;
  };
}

/** A person's most recent state legislative votes, newest first, and how many there are. */
export async function getStateVotes(
  db: Db | Tx,
  personId: number,
  limit = 20,
): Promise<{ total: number; votes: StateVoteView[] }> {
  const ids = (
    await db
      .select({ value: personIdentifier.value })
      .from(personIdentifier)
      .where(
        and(eq(personIdentifier.personId, personId), eq(personIdentifier.scheme, 'openstates')),
      )
  ).map((r) => r.value);
  if (ids.length === 0) return { total: 0, votes: [] };
  const mine = inArray(stateVotePosition.osPersonId, ids);
  const [counted] = await db.select({ n: count() }).from(stateVotePosition).where(mine);
  const rows = await db
    .select({
      voteId: stateVote.id,
      votedOn: stateVote.votedOn,
      chamber: stateVote.chamber,
      motion: stateVote.motion,
      result: stateVote.result,
      yes: stateVote.yes,
      no: stateVote.no,
      other: stateVote.other,
      option: stateVotePosition.option,
      sourceUrl: stateVote.sourceUrl,
      state: stateBill.state,
      session: stateBill.session,
      identifier: stateBill.identifier,
      title: stateBill.title,
      openstatesUrl: stateBill.openstatesUrl,
    })
    .from(stateVotePosition)
    .innerJoin(stateVote, eq(stateVote.id, stateVotePosition.voteId))
    .innerJoin(stateBill, eq(stateBill.id, stateVote.billId))
    .where(mine)
    .orderBy(desc(stateVote.votedOn), desc(stateVote.id))
    .limit(limit);
  return {
    total: counted?.n ?? 0,
    votes: rows.map(({ state, session, identifier, title, openstatesUrl, ...v }) => ({
      ...v,
      bill: { state, session, identifier, title, openstatesUrl },
    })),
  };
}
