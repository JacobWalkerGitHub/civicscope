import { asc, desc, eq, isNull } from 'drizzle-orm';
import {
  candidacyInputSchema,
  defaultSortName,
  personInputSchema,
  statusEventInputSchema,
  type PublishState,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { countLiveCitations, insertCitation } from './citations';
import { CmsError, mysqlErrorCode, NotFoundError } from './errors';
import { lockChangedFields, lockField } from './locks';
import { parseInput } from './parse';
import { resolveSource } from './sources';
import { uniqueSlug } from './slugs';

const {
  candidacy,
  candidacyStatusEvent,
  person,
  race,
  election,
  party,
  office,
  source,
  adminUser,
} = schema;
export type Candidacy = typeof candidacy.$inferSelect;
export const CANDIDACY_EDITABLE = [
  'partyId',
  'ballotName',
  'isIncumbent',
  'campaignUrl',
  'fecCommitteeId',
] as const;

async function load(tx: Tx | Db, id: number): Promise<Candidacy> {
  const [row] = await tx.select().from(candidacy).where(eq(candidacy.id, id));
  if (!row) throw new NotFoundError('Candidacy');
  return row;
}

/**
 * In a partisan primary the race belongs to one party, so every candidate in it carries
 * that party. Otherwise the party is whatever label appears on the ballot (or none).
 */
async function checkCandidacy(
  tx: Tx,
  data: { personId: number; raceId: number; partyId?: number | null },
) {
  const [raceRow] = await tx.select().from(race).where(eq(race.id, data.raceId));
  if (!raceRow) throw new NotFoundError('Race');
  if (raceRow.deletedAt) throw new CmsError('That race is archived.');
  const [personRow] = await tx.select().from(person).where(eq(person.id, data.personId));
  if (!personRow) throw new NotFoundError('Person');
  if (personRow.deletedAt) {
    throw new CmsError('That person is archived.', { personId: 'This person is archived.' });
  }
  if (raceRow.partyId && data.partyId && data.partyId !== raceRow.partyId) {
    throw new CmsError('This is one party’s primary, so candidates carry that party.', {
      partyId: 'Must match the primary’s party.',
    });
  }
  if (data.partyId) {
    const [partyRow] = await tx.select().from(party).where(eq(party.id, data.partyId));
    if (!partyRow || partyRow.deletedAt) {
      throw new CmsError('That party is archived.', { partyId: 'This party is archived.' });
    }
  }
  return { raceRow, personRow, partyId: raceRow.partyId ?? data.partyId ?? null };
}

function translateError(error: unknown): never {
  if (mysqlErrorCode(error) === 'ER_DUP_ENTRY') {
    throw new CmsError('This person is already a candidate in this race.', {
      personId: 'Already a candidate here.',
    });
  }
  throw error;
}

export async function createCandidacy(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(candidacyInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const { personRow, partyId } = await checkCandidacy(tx, data);
      const [res] = await tx.insert(candidacy).values({
        ...data,
        partyId,
        ballotName: data.ballotName ?? personRow.fullName,
      });
      await recordChange(tx, actor, {
        entityType: 'candidacy',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: await load(tx, res.insertId),
      });
      return res.insertId;
    });
  } catch (error) {
    translateError(error);
  }
}

/**
 * Adds someone new to a race in one step: creates the person (a draft) and their
 * candidacy together, so a failed candidacy never leaves a stray person behind.
 */
export async function createPersonWithCandidacy(
  db: Db,
  actor: Actor,
  input: Record<string, unknown>,
): Promise<{ personId: number; candidacyId: number }> {
  const p = parseInput(personInputSchema, input);
  const c = parseInput(candidacyInputSchema, { ...input, personId: 1 });
  try {
    return await db.transaction(async (tx) => {
      const slug = await uniqueSlug(tx, person, person.slug, p.fullName);
      const [pr] = await tx
        .insert(person)
        .values({ ...p, sortName: p.sortName ?? defaultSortName(p.fullName), slug });
      const personId = pr.insertId;
      const [personRow] = await tx.select().from(person).where(eq(person.id, personId));
      await recordChange(tx, actor, {
        entityType: 'person',
        entityId: personId,
        action: 'create',
        before: null,
        after: personRow!,
      });
      const { partyId } = await checkCandidacy(tx, { ...c, personId });
      const [res] = await tx.insert(candidacy).values({
        ...c,
        personId,
        partyId,
        ballotName: c.ballotName ?? personRow!.fullName,
      });
      await recordChange(tx, actor, {
        entityType: 'candidacy',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: await load(tx, res.insertId),
      });
      return { personId, candidacyId: res.insertId };
    });
  } catch (error) {
    translateError(error);
  }
}

export async function updateCandidacy(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const before = await load(tx, id);
      if (before.deletedAt) throw new CmsError('Restore this candidacy before editing.');
      const data = parseInput(candidacyInputSchema, {
        ...(input as object),
        personId: before.personId,
        raceId: before.raceId,
      });
      const { personRow, partyId } = await checkCandidacy(tx, data);
      await tx
        .update(candidacy)
        .set({
          partyId,
          ballotName: data.ballotName ?? personRow.fullName,
          isIncumbent: data.isIncumbent,
          campaignUrl: data.campaignUrl ?? null,
          fecCommitteeId: data.fecCommitteeId ?? null,
        })
        .where(eq(candidacy.id, id));
      const after = await load(tx, id);
      await lockChangedFields(tx, actor, 'candidacy', id, before, after);
      await recordChange(tx, actor, {
        entityType: 'candidacy',
        entityId: id,
        action: opts.action ?? 'update',
        before,
        after,
        note: opts.note,
      });
    });
  } catch (error) {
    translateError(error);
  }
}

/**
 * Records a dated, sourced status change. The source also becomes a citation of the
 * candidacy for its "status" field. The candidacy's current status is the event with
 * the latest date (ties go to the one recorded last).
 */
export async function addStatusEvent(
  db: Db,
  actor: Actor,
  candidacyId: number,
  input: unknown,
): Promise<void> {
  const data = parseInput(statusEventInputSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, candidacyId);
    if (before.deletedAt) throw new CmsError('Restore this candidacy before editing.');
    const src = await resolveSource(tx, actor, data);
    await tx.insert(candidacyStatusEvent).values({
      candidacyId,
      status: data.status,
      effectiveDate: data.effectiveDate,
      sourceId: src.id,
      note: data.note ?? null,
      recordedBy: String(actor.userId),
    });
    await insertCitation(tx, actor, {
      sourceId: src.id,
      subjectType: 'candidacy',
      subjectId: candidacyId,
      field: 'status',
      excerpt: data.excerpt ?? null,
      locator: null,
    });
    const [latest] = await tx
      .select({ status: candidacyStatusEvent.status, date: candidacyStatusEvent.effectiveDate })
      .from(candidacyStatusEvent)
      .where(eq(candidacyStatusEvent.candidacyId, candidacyId))
      .orderBy(desc(candidacyStatusEvent.effectiveDate), desc(candidacyStatusEvent.id))
      .limit(1);
    await tx
      .update(candidacy)
      .set({ status: latest!.status, statusDate: latest!.date })
      .where(eq(candidacy.id, candidacyId));
    await lockField(tx, actor, 'candidacy', candidacyId, 'status', 'Status recorded by hand');
    await recordChange(tx, actor, {
      entityType: 'candidacy',
      entityId: candidacyId,
      action: 'update',
      before,
      after: await load(tx, candidacyId),
      note: `Status recorded: ${data.status} as of ${data.effectiveDate}`,
    });
  });
}

/**
 * A candidacy goes public only when its person and race are public, it has a status,
 * and at least one source backs it.
 */
export async function setCandidacyPublishState(
  db: Db,
  actor: Actor,
  id: number,
  state: Extract<PublishState, 'published' | 'unpublished'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this candidacy before publishing.');
    if (state === 'published') {
      const [p] = await tx.select().from(person).where(eq(person.id, before.personId));
      if (p?.publishState !== 'published') throw new CmsError('Publish the person first.');
      const [r] = await tx.select().from(race).where(eq(race.id, before.raceId));
      if (r?.publishState !== 'published') throw new CmsError('Publish the race first.');
      if (!before.status) {
        throw new CmsError('Record a sourced status (for example "filed") before publishing.');
      }
      if ((await countLiveCitations(tx, 'candidacy', id)) === 0) {
        throw new CmsError('Add at least one source for this candidacy before publishing.');
      }
    }
    if (before.publishState === state) return;
    await tx.update(candidacy).set({ publishState: state }).where(eq(candidacy.id, id));
    await recordChange(tx, actor, {
      entityType: 'candidacy',
      entityId: id,
      action: state === 'published' ? 'publish' : 'unpublish',
      before,
      after: await load(tx, id),
    });
  });
}

export async function setCandidacyArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (!archived) await checkCandidacy(tx, before);
    await tx
      .update(candidacy)
      .set({
        deletedAt: archived ? new Date() : null,
        publishState: archived ? 'archived' : 'draft',
      })
      .where(eq(candidacy.id, id));
    await recordChange(tx, actor, {
      entityType: 'candidacy',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listCandidaciesForRace(db: Db, raceId: number) {
  return db
    .select({
      id: candidacy.id,
      personId: candidacy.personId,
      ballotName: candidacy.ballotName,
      isIncumbent: candidacy.isIncumbent,
      status: candidacy.status,
      statusDate: candidacy.statusDate,
      publishState: candidacy.publishState,
      deletedAt: candidacy.deletedAt,
      partyName: party.name,
    })
    .from(candidacy)
    .leftJoin(party, eq(candidacy.partyId, party.id))
    .where(eq(candidacy.raceId, raceId))
    .orderBy(asc(candidacy.ballotName));
}

export async function listCandidaciesForPerson(db: Db, personId: number) {
  return db
    .select({
      id: candidacy.id,
      status: candidacy.status,
      publishState: candidacy.publishState,
      deletedAt: candidacy.deletedAt,
      raceId: race.id,
      raceName: race.name,
      electionName: election.name,
      electionDate: election.date,
      partyName: party.name,
    })
    .from(candidacy)
    .innerJoin(race, eq(candidacy.raceId, race.id))
    .innerJoin(election, eq(race.electionId, election.id))
    .leftJoin(party, eq(candidacy.partyId, party.id))
    .where(eq(candidacy.personId, personId))
    .orderBy(desc(election.date));
}

export async function listStatusEvents(db: Db, candidacyId: number) {
  return db
    .select({
      id: candidacyStatusEvent.id,
      status: candidacyStatusEvent.status,
      effectiveDate: candidacyStatusEvent.effectiveDate,
      note: candidacyStatusEvent.note,
      createdAt: candidacyStatusEvent.createdAt,
      recordedByName: adminUser.name,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceUrl: source.url,
    })
    .from(candidacyStatusEvent)
    .innerJoin(source, eq(candidacyStatusEvent.sourceId, source.id))
    .leftJoin(adminUser, eq(adminUser.id, candidacyStatusEvent.recordedBy))
    .where(eq(candidacyStatusEvent.candidacyId, candidacyId))
    .orderBy(desc(candidacyStatusEvent.effectiveDate), desc(candidacyStatusEvent.id));
}

/** Candidacy plus the names needed to show it in context. */
export async function getCandidacy(db: Db, id: number) {
  const row = await load(db, id);
  const [ctx] = await db
    .select({
      personName: person.fullName,
      raceName: race.name,
      racePartyId: race.partyId,
      electionId: election.id,
      electionName: election.name,
      officeTitle: office.title,
    })
    .from(race)
    .innerJoin(election, eq(race.electionId, election.id))
    .innerJoin(office, eq(race.officeId, office.id))
    .innerJoin(person, eq(person.id, row.personId))
    .where(eq(race.id, row.raceId));
  return { ...row, ...ctx! };
}

/** People who can still be added to a race: not archived and not already in it. */
export async function listPeopleForRace(db: Db, raceId: number) {
  const taken = db
    .select({ id: candidacy.personId })
    .from(candidacy)
    .where(eq(candidacy.raceId, raceId));
  const rows = await db
    .select({ id: person.id, fullName: person.fullName, sortName: person.sortName })
    .from(person)
    .where(isNull(person.deletedAt))
    .orderBy(asc(person.sortName));
  const takenIds = new Set((await taken).map((r) => r.id));
  return rows.filter((r) => !takenIds.has(r.id));
}
