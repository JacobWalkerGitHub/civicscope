import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  electionInputSchema,
  raceInputSchema,
  validateRaceForElection,
  type PublishState,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { CmsError, mysqlErrorCode, NotFoundError } from './errors';
import { parseInput } from './parse';

const { election, electionCycle, race, jurisdiction, office, party, district } = schema;
export type Election = typeof election.$inferSelect;
export type Race = typeof race.$inferSelect;

export const ELECTION_EDITABLE = [
  'jurisdictionId',
  'type',
  'primarySystem',
  'date',
  'name',
  'officialUrl',
] as const;
export const RACE_EDITABLE = [
  'officeId',
  'districtId',
  'partyId',
  'name',
  'seats',
  'isSpecial',
  'status',
] as const;

async function loadElection(tx: Tx | Db, id: number): Promise<Election> {
  const [row] = await tx.select().from(election).where(eq(election.id, id));
  if (!row) throw new NotFoundError('Election');
  return row;
}

async function loadRace(tx: Tx | Db, id: number): Promise<Race> {
  const [row] = await tx.select().from(race).where(eq(race.id, id));
  if (!row) throw new NotFoundError('Race');
  return row;
}

/** The cycle for an election date's year, created on first use. */
async function cycleFor(tx: Tx, date: string): Promise<number> {
  const year = Number(date.slice(0, 4));
  const [existing] = await tx.select().from(electionCycle).where(eq(electionCycle.year, year));
  if (existing) return existing.id;
  const [res] = await tx.insert(electionCycle).values({ year, label: String(year) });
  return res.insertId;
}

function translateElectionError(error: unknown): never {
  const code = mysqlErrorCode(error);
  if (code === 'ER_DUP_ENTRY') {
    throw new CmsError('This state already has an election of that type on that date.', {
      date: 'Already exists for this state and type.',
    });
  }
  if (code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED') {
    throw new CmsError(
      'This election already has races, so its type and primary system cannot change. Archive its races first, or create a new election.',
      { type: 'Locked because races exist.' },
    );
  }
  throw error;
}

export async function createElection(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(electionInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const cycleId = await cycleFor(tx, data.date);
      const [res] = await tx.insert(election).values({ ...data, cycleId });
      await recordChange(tx, actor, {
        entityType: 'election',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: await loadElection(tx, res.insertId),
      });
      return res.insertId;
    });
  } catch (error) {
    translateElectionError(error);
  }
}

export async function updateElection(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(electionInputSchema, input);
  try {
    await db.transaction(async (tx) => {
      const before = await loadElection(tx, id);
      const cycleId = await cycleFor(tx, data.date);
      await tx
        .update(election)
        .set({ ...data, cycleId })
        .where(eq(election.id, id));
      await recordChange(tx, actor, {
        entityType: 'election',
        entityId: id,
        action: opts.action ?? 'update',
        before,
        after: await loadElection(tx, id),
        note: opts.note,
      });
    });
  } catch (error) {
    translateElectionError(error);
  }
}

function translateRaceError(error: unknown): never {
  if (mysqlErrorCode(error) === 'ER_DUP_ENTRY') {
    throw new CmsError('This election already has that race (same office, district and party).', {
      officeId: 'Duplicate race.',
    });
  }
  throw error;
}

async function checkRace(
  tx: Tx,
  electionRow: Election,
  data: { officeId: number; districtId?: number | null; partyId?: number | null },
) {
  if (electionRow.deletedAt) throw new CmsError('That election is archived.');
  const problems = validateRaceForElection(data, electionRow);
  if (problems.length > 0) throw new CmsError(problems[0]!, { partyId: problems[0]! });

  const [officeRow] = await tx.select().from(office).where(eq(office.id, data.officeId));
  if (!officeRow || officeRow.deletedAt) {
    throw new CmsError('Choose an office.', { officeId: 'Choose an office.' });
  }
  if (data.districtId) {
    const [d] = await tx.select().from(district).where(eq(district.id, data.districtId));
    if (!d || d.deletedAt) throw new CmsError('Choose a district.', { districtId: 'Not found.' });
  }
}

export async function createRace(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(raceInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const electionRow = await loadElection(tx, data.electionId);
      await checkRace(tx, electionRow, data);
      const [res] = await tx.insert(race).values({
        ...data,
        electionType: electionRow.type,
        primarySystem: electionRow.primarySystem,
      });
      await recordChange(tx, actor, {
        entityType: 'race',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: await loadRace(tx, res.insertId),
      });
      return res.insertId;
    });
  } catch (error) {
    translateRaceError(error);
  }
}

/** Updates a race. A race never moves to a different election. */
export async function updateRace(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const before = await loadRace(tx, id);
      const data = parseInput(raceInputSchema, {
        ...(input as object),
        electionId: before.electionId,
      });
      const electionRow = await loadElection(tx, before.electionId);
      await checkRace(tx, electionRow, data);
      const changes: Partial<typeof data> = { ...data };
      delete changes.electionId;
      await tx.update(race).set(changes).where(eq(race.id, id));
      await recordChange(tx, actor, {
        entityType: 'race',
        entityId: id,
        action: opts.action ?? 'update',
        before,
        after: await loadRace(tx, id),
        note: opts.note,
      });
    });
  } catch (error) {
    translateRaceError(error);
  }
}

type Publishable = 'election' | 'race';

/**
 * Publishes or unpublishes an election or race. A race can only be published once its
 * election is published, so the public site never shows a race without its election.
 */
export async function setPublishState(
  db: Db,
  actor: Actor,
  entityType: Publishable,
  id: number,
  state: Extract<PublishState, 'published' | 'unpublished'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const table = entityType === 'election' ? election : race;
    const before = entityType === 'election' ? await loadElection(tx, id) : await loadRace(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this record before publishing it.');
    if (entityType === 'race' && state === 'published') {
      const parent = await loadElection(tx, (before as Race).electionId);
      if (parent.publishState !== 'published' || parent.deletedAt) {
        throw new CmsError('Publish the election first; a race cannot appear without it.');
      }
    }
    if (before.publishState === state) return;
    await tx.update(table).set({ publishState: state }).where(eq(table.id, id));
    const after = entityType === 'election' ? await loadElection(tx, id) : await loadRace(tx, id);
    await recordChange(tx, actor, {
      entityType,
      entityId: id,
      action: state === 'published' ? 'publish' : 'unpublish',
      before,
      after,
    });
  });
}

/** Archiving hides a record everywhere public without destroying its history. */
export async function setArchived(
  db: Db,
  actor: Actor,
  entityType: Publishable,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const table = entityType === 'election' ? election : race;
    const before = entityType === 'election' ? await loadElection(tx, id) : await loadRace(tx, id);
    if (entityType === 'election' && archived) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(race)
        .where(and(eq(race.electionId, id), isNull(race.deletedAt)));
      if (Number(row?.n) > 0) {
        throw new CmsError('Archive this election’s races first.');
      }
    }
    await tx
      .update(table)
      .set({
        deletedAt: archived ? new Date() : null,
        // An archived record is never public; restoring it brings it back as a draft.
        publishState: archived ? 'archived' : 'draft',
      })
      .where(eq(table.id, id));
    const after = entityType === 'election' ? await loadElection(tx, id) : await loadRace(tx, id);
    await recordChange(tx, actor, {
      entityType,
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after,
    });
  });
}

export async function listElections(
  db: Db,
  filters: { jurisdictionId?: number; year?: number; includeArchived?: boolean } = {},
) {
  return db
    .select({
      id: election.id,
      name: election.name,
      date: election.date,
      type: election.type,
      primarySystem: election.primarySystem,
      publishState: election.publishState,
      deletedAt: election.deletedAt,
      jurisdictionName: jurisdiction.name,
      raceCount: sql<number>`(select count(*) from ${race} where ${race.electionId} = ${election.id} and ${race.deletedAt} is null)`,
    })
    .from(election)
    .innerJoin(jurisdiction, eq(election.jurisdictionId, jurisdiction.id))
    .innerJoin(electionCycle, eq(election.cycleId, electionCycle.id))
    .where(
      and(
        filters.includeArchived ? undefined : isNull(election.deletedAt),
        filters.jurisdictionId ? eq(election.jurisdictionId, filters.jurisdictionId) : undefined,
        filters.year ? eq(electionCycle.year, filters.year) : undefined,
      ),
    )
    .orderBy(asc(election.date), asc(jurisdiction.name));
}

export const getElection = (db: Db, id: number) => loadElection(db, id);
export const getRace = (db: Db, id: number) => loadRace(db, id);

export async function listRaces(db: Db, electionId: number) {
  return db
    .select({
      id: race.id,
      name: race.name,
      status: race.status,
      seats: race.seats,
      isSpecial: race.isSpecial,
      publishState: race.publishState,
      deletedAt: race.deletedAt,
      officeTitle: office.title,
      partyName: party.name,
      districtLabel: district.label,
    })
    .from(race)
    .innerJoin(office, eq(race.officeId, office.id))
    .leftJoin(party, eq(race.partyId, party.id))
    .leftJoin(district, eq(race.districtId, district.id))
    .where(eq(race.electionId, electionId))
    .orderBy(asc(office.title), asc(district.label), asc(party.name));
}

export async function listCycleYears(db: Db): Promise<number[]> {
  const rows = await db
    .select({ year: electionCycle.year })
    .from(electionCycle)
    .orderBy(desc(electionCycle.year));
  return rows.map((r) => r.year);
}
