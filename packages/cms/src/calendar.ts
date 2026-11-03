import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  electionDeadlineInputSchema,
  officialResourceInputSchema,
  todayIso,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';
import type { ViewOptions } from './public';

const { election, electionCycle, electionDeadline, jurisdiction, officialResource, office, race } =
  schema;

/*
 * The election calendar: key dates for each election (filing, registration, early
 * voting...) and links to each state's official election resources. Every date names
 * the official document that sets it; the public site links to it next to the date.
 */

export type ElectionDeadline = typeof electionDeadline.$inferSelect;
export type OfficialResource = typeof officialResource.$inferSelect;

async function loadDeadline(tx: Tx | Db, id: number): Promise<ElectionDeadline> {
  const [row] = await tx.select().from(electionDeadline).where(eq(electionDeadline.id, id));
  if (!row) throw new NotFoundError('Date');
  return row;
}

async function loadResource(tx: Tx | Db, id: number): Promise<OfficialResource> {
  const [row] = await tx.select().from(officialResource).where(eq(officialResource.id, id));
  if (!row) throw new NotFoundError('Resource');
  return row;
}

async function liveElection(tx: Tx, id: number) {
  const [row] = await tx.select().from(election).where(eq(election.id, id));
  if (!row) throw new NotFoundError('Election');
  if (row.deletedAt) throw new CmsError('That election is archived.');
  return row;
}

/**
 * Key dates fall before the election they belong to (registration, filing) or within a
 * few weeks after it (certification). Anything further off is almost always a typo.
 */
function checkDateNearElection(date: string, electionDate: string) {
  const days = (Date.parse(electionDate) - Date.parse(date)) / 86_400_000;
  if (days > 730 || days < -90) {
    throw new CmsError('That date is far from the election date. Check the year.', {
      date: 'More than two years before, or three months after, the election.',
    });
  }
}

export async function createDeadline(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(electionDeadlineInputSchema, input);
  return db.transaction(async (tx) => {
    const e = await liveElection(tx, data.electionId);
    checkDateNearElection(data.date, e.date);
    const [res] = await tx.insert(electionDeadline).values(data);
    await recordChange(tx, actor, {
      entityType: 'election_deadline',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await loadDeadline(tx, res.insertId),
    });
    return res.insertId;
  });
}

/** Updates a date. A date never moves to a different election. */
export async function updateDeadline(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadDeadline(tx, id);
    const data = parseInput(electionDeadlineInputSchema, {
      ...(input as object),
      electionId: before.electionId,
    });
    const e = await liveElection(tx, before.electionId);
    checkDateNearElection(data.date, e.date);
    await tx
      .update(electionDeadline)
      .set({ kind: data.kind, date: data.date, label: data.label, sourceUrl: data.sourceUrl })
      .where(eq(electionDeadline.id, id));
    await recordChange(tx, actor, {
      entityType: 'election_deadline',
      entityId: id,
      action: 'update',
      before,
      after: await loadDeadline(tx, id),
    });
  });
}

/** Removes a date entered in error. The history keeps what it said. */
export async function removeDeadline(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadDeadline(tx, id);
    await tx.delete(electionDeadline).where(eq(electionDeadline.id, id));
    await recordChange(tx, actor, {
      entityType: 'election_deadline',
      entityId: id,
      action: 'delete',
      before,
      after: { ...before, deleted: true },
    });
  });
}

export const getDeadline = (db: Db, id: number) => loadDeadline(db, id);

export async function listDeadlines(db: Db, electionId: number) {
  return db
    .select()
    .from(electionDeadline)
    .where(eq(electionDeadline.electionId, electionId))
    .orderBy(asc(electionDeadline.date), asc(electionDeadline.id));
}

export async function createResource(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(officialResourceInputSchema, input);
  return db.transaction(async (tx) => {
    const [j] = await tx
      .select()
      .from(jurisdiction)
      .where(eq(jurisdiction.id, data.jurisdictionId));
    if (!j) throw new CmsError('Choose a state.', { jurisdictionId: 'Not found.' });
    const [dupe] = await tx
      .select({ id: officialResource.id })
      .from(officialResource)
      .where(
        and(
          eq(officialResource.jurisdictionId, data.jurisdictionId),
          eq(officialResource.url, data.url),
          isNull(officialResource.deletedAt),
        ),
      );
    if (dupe) throw new CmsError('This state already has that link.', { url: 'Already listed.' });
    // Whoever adds a link has just opened it.
    const [res] = await tx.insert(officialResource).values({ ...data, lastCheckedAt: new Date() });
    await recordChange(tx, actor, {
      entityType: 'official_resource',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await loadResource(tx, res.insertId),
    });
    return res.insertId;
  });
}

export async function updateResource(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadResource(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this link before editing it.');
    const data = parseInput(officialResourceInputSchema, {
      ...(input as object),
      jurisdictionId: before.jurisdictionId,
    });
    await tx
      .update(officialResource)
      .set({ kind: data.kind, label: data.label, url: data.url, lastCheckedAt: new Date() })
      .where(eq(officialResource.id, id));
    await recordChange(tx, actor, {
      entityType: 'official_resource',
      entityId: id,
      action: 'update',
      before,
      after: await loadResource(tx, id),
    });
  });
}

/** Records that someone opened the link today and it still works. Not a content change. */
export async function markResourceChecked(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadResource(tx, id);
    await tx
      .update(officialResource)
      .set({ lastCheckedAt: new Date() })
      .where(eq(officialResource.id, id));
    await recordChange(tx, actor, {
      entityType: 'official_resource',
      entityId: id,
      action: 'update',
      before,
      after: await loadResource(tx, id),
      note: 'Link checked',
    });
  });
}

export async function setResourceArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadResource(tx, id);
    await tx
      .update(officialResource)
      .set({ deletedAt: archived ? new Date() : null })
      .where(eq(officialResource.id, id));
    await recordChange(tx, actor, {
      entityType: 'official_resource',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await loadResource(tx, id),
    });
  });
}

export async function listResources(
  db: Db,
  jurisdictionId: number,
  opts: { includeArchived?: boolean } = {},
) {
  return db
    .select()
    .from(officialResource)
    .where(
      and(
        eq(officialResource.jurisdictionId, jurisdictionId),
        opts.includeArchived ? undefined : isNull(officialResource.deletedAt),
      ),
    )
    .orderBy(asc(officialResource.kind), asc(officialResource.label));
}

// ---------------------------------------------------------------------------------
// Public reads. Elections show only when published and not archived; their key dates
// and the state's official links come with them.

const visibleElection = ({ preview = false }: ViewOptions) =>
  preview
    ? isNull(election.deletedAt)
    : and(eq(election.publishState, 'published'), isNull(election.deletedAt));

const visibleRace = ({ preview = false }: ViewOptions) =>
  preview
    ? isNull(race.deletedAt)
    : and(eq(race.publishState, 'published'), isNull(race.deletedAt));

/**
 * The public calendar: published elections from `from` (default today) on, soonest
 * first, each with its key dates. Pass `year` for one cycle, past dates included.
 */
export async function listPublicElections(
  db: Db,
  opts: ViewOptions & { from?: string; year?: number; jurisdictionId?: number } = {},
) {
  const from = opts.year ? undefined : (opts.from ?? todayIso());
  const elections = await db
    .select({
      id: election.id,
      name: election.name,
      date: election.date,
      type: election.type,
      primarySystem: election.primarySystem,
      officialUrl: election.officialUrl,
      publishState: election.publishState,
      jurisdictionId: jurisdiction.id,
      jurisdictionName: jurisdiction.name,
      cycleYear: electionCycle.year,
    })
    .from(election)
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .innerJoin(electionCycle, eq(electionCycle.id, election.cycleId))
    .where(
      and(
        visibleElection(opts),
        from ? gte(election.date, from) : undefined,
        opts.year ? eq(electionCycle.year, opts.year) : undefined,
        opts.jurisdictionId ? eq(election.jurisdictionId, opts.jurisdictionId) : undefined,
      ),
    )
    .orderBy(asc(election.date), asc(jurisdiction.name), asc(election.name));
  const ids = elections.map((e) => e.id);
  const deadlines = ids.length
    ? await db
        .select()
        .from(electionDeadline)
        .where(inArray(electionDeadline.electionId, ids))
        .orderBy(asc(electionDeadline.date), asc(electionDeadline.id))
    : [];
  const raceCounts = ids.length
    ? await db
        .select({ electionId: race.electionId, id: race.id })
        .from(race)
        .where(and(inArray(race.electionId, ids), visibleRace(opts)))
    : [];
  return elections.map((e) => ({
    ...e,
    deadlines: deadlines.filter((d) => d.electionId === e.id),
    raceCount: raceCounts.filter((r) => r.electionId === e.id).length,
  }));
}

/** Years that have at least one public election, newest first. */
export async function listPublicElectionYears(db: Db, opts: ViewOptions = {}) {
  const rows = await db
    .selectDistinct({ year: electionCycle.year })
    .from(election)
    .innerJoin(electionCycle, eq(electionCycle.id, election.cycleId))
    .where(visibleElection(opts))
    .orderBy(asc(electionCycle.year));
  return rows.map((r) => r.year).reverse();
}

/** One public election: its key dates, its public races and the state's official links. */
export async function getPublicElection(db: Db, id: number, opts: ViewOptions = {}) {
  const [e] = await db
    .select({
      id: election.id,
      name: election.name,
      date: election.date,
      type: election.type,
      primarySystem: election.primarySystem,
      officialUrl: election.officialUrl,
      publishState: election.publishState,
      jurisdictionId: jurisdiction.id,
      jurisdictionName: jurisdiction.name,
    })
    .from(election)
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .where(and(eq(election.id, id), visibleElection(opts)));
  if (!e) return null;
  const deadlines = await listDeadlines(db, id);
  const races = await db
    .select({
      id: race.id,
      name: race.name,
      publishState: race.publishState,
      officeTitle: office.title,
    })
    .from(race)
    .innerJoin(office, eq(office.id, race.officeId))
    .where(and(eq(race.electionId, id), visibleRace(opts)))
    .orderBy(asc(race.name));
  const resources = await listResources(db, e.jurisdictionId);
  // Other public elections in the same state and year (e.g. the primary for a general).
  const year = e.date.slice(0, 4);
  const related = await db
    .select({ id: election.id, name: election.name, date: election.date })
    .from(election)
    .where(
      and(
        eq(election.jurisdictionId, e.jurisdictionId),
        visibleElection(opts),
        gte(election.date, `${year}-01-01`),
        lte(election.date, `${year}-12-31`),
      ),
    )
    .orderBy(asc(election.date));
  return {
    election: e,
    deadlines,
    races,
    resources,
    related: related.filter((r) => r.id !== id),
  };
}
