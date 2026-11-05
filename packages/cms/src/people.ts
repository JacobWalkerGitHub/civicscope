import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import {
  defaultSortName,
  personIdentifierInputSchema,
  personInputSchema,
  type PublishState,
} from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { countLiveCitations } from './citations';
import { CmsError, mysqlErrorCode, NotFoundError } from './errors';
import { parseInput } from './parse';
import { uniqueSlug } from './slugs';

const { person, personIdentifier, candidacy, claim } = schema;
export type Person = typeof person.$inferSelect;
export const PERSON_EDITABLE = ['fullName', 'preferredName', 'sortName', 'birthYear'] as const;

async function load(tx: Tx | Db, id: number): Promise<Person> {
  const [row] = await tx.select().from(person).where(eq(person.id, id));
  if (!row) throw new NotFoundError('Person');
  return row;
}

export async function createPerson(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(personInputSchema, input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, person, person.slug, data.fullName);
    const [res] = await tx
      .insert(person)
      .values({ ...data, sortName: data.sortName ?? defaultSortName(data.fullName), slug });
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await load(tx, res.insertId),
    });
    return res.insertId;
  });
}

export async function updatePerson(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(personInputSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this person before editing.');
    await tx
      .update(person)
      .set({ ...data, sortName: data.sortName ?? defaultSortName(data.fullName) })
      .where(eq(person.id, id));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: id,
      action: opts.action ?? 'update',
      before,
      after: await load(tx, id),
      note: opts.note,
    });
  });
}

/** No citation, no publish: a person needs at least one source before going public. */
export async function setPersonPublishState(
  db: Db,
  actor: Actor,
  id: number,
  state: Extract<PublishState, 'published' | 'unpublished'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this person before publishing.');
    if (state === 'published' && (await countLiveCitations(tx, 'person', id)) === 0) {
      throw new CmsError('Add at least one source for this person before publishing.');
    }
    if (state === 'unpublished') {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(candidacy)
        .where(and(eq(candidacy.personId, id), eq(candidacy.publishState, 'published')));
      if (Number(row?.n) > 0) throw new CmsError('Unpublish this person’s candidacies first.');
      const [claims] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(claim)
        .where(and(eq(claim.personId, id), eq(claim.publishState, 'published')));
      if (Number(claims?.n) > 0) {
        throw new CmsError('Unpublish this person’s profile entries first.');
      }
    }
    if (before.publishState === state) return;
    await tx.update(person).set({ publishState: state }).where(eq(person.id, id));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: id,
      action: state === 'published' ? 'publish' : 'unpublish',
      before,
      after: await load(tx, id),
    });
  });
}

export async function setPersonArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (!archived && before.mergedIntoId) {
      throw new CmsError(
        `This record was merged into person ${before.mergedIntoId}. Edit that record instead.`,
      );
    }
    if (archived) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(candidacy)
        .where(and(eq(candidacy.personId, id), isNull(candidacy.deletedAt)));
      if (Number(row?.n) > 0) throw new CmsError('Archive this person’s candidacies first.');
      const [claims] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(claim)
        .where(and(eq(claim.personId, id), isNull(claim.deletedAt)));
      if (Number(claims?.n) > 0) {
        throw new CmsError('Archive this person’s profile entries first.');
      }
    }
    await tx
      .update(person)
      .set({
        deletedAt: archived ? new Date() : null,
        publishState: archived ? 'archived' : 'draft',
      })
      .where(eq(person.id, id));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function addPersonIdentifier(
  db: Db,
  actor: Actor,
  personId: number,
  input: unknown,
): Promise<number> {
  const data = parseInput(personIdentifierInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const owner = await load(tx, personId);
      if (owner.deletedAt) throw new CmsError('Restore this person before editing.');
      const [res] = await tx.insert(personIdentifier).values({ personId, ...data });
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
        note: `Added to person ${personId}`,
      });
      return res.insertId;
    });
  } catch (error) {
    if (mysqlErrorCode(error) === 'ER_DUP_ENTRY') {
      const [other] = await db
        .select({ personId: personIdentifier.personId, name: person.fullName })
        .from(personIdentifier)
        .innerJoin(person, eq(person.id, personIdentifier.personId))
        .where(
          and(eq(personIdentifier.scheme, data.scheme), eq(personIdentifier.value, data.value)),
        );
      throw new CmsError(
        other?.personId === personId
          ? 'This person already has that ID.'
          : `That ID already belongs to ${other?.name ?? 'another person'}. If they are the same person, merge them instead.`,
        { value: 'Already in use.' },
      );
    }
    throw error;
  }
}

/** Identifiers are matching keys, not facts shown publicly, so removing one is a plain delete (audited). */
export async function removePersonIdentifier(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(personIdentifier).where(eq(personIdentifier.id, id));
    if (!before) throw new NotFoundError('ID');
    await tx.delete(personIdentifier).where(eq(personIdentifier.id, id));
    await recordAuditDelete(tx, actor, before);
  });
}

async function recordAuditDelete(
  tx: Tx,
  actor: Actor,
  before: typeof personIdentifier.$inferSelect,
) {
  await recordAudit(tx, {
    actorType: 'user',
    actorId: String(actor.userId),
    action: 'delete',
    entityType: 'person_identifier',
    entityId: String(before.id),
    diff: { scheme: [before.scheme, null], value: [before.value, null] },
    note: `Removed from person ${before.personId}`,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function listPersonIdentifiers(db: Db, personId: number) {
  return db
    .select()
    .from(personIdentifier)
    .where(eq(personIdentifier.personId, personId))
    .orderBy(asc(personIdentifier.scheme));
}

export async function listPeople(
  db: Db,
  { query, includeArchived = false }: { query?: string; includeArchived?: boolean } = {},
) {
  const q = query?.trim();
  return db
    .select({
      id: person.id,
      fullName: person.fullName,
      sortName: person.sortName,
      publishState: person.publishState,
      deletedAt: person.deletedAt,
      // Aliased on purpose; see listSources.
      candidacyCount: sql<number>`(select count(*) from candidacy c where c.person_id = ${person}.id and c.deleted_at is null)`,
    })
    .from(person)
    .where(
      and(
        includeArchived ? undefined : isNull(person.deletedAt),
        q
          ? or(
              like(person.fullName, `%${q}%`),
              like(person.preferredName, `%${q}%`),
              like(person.sortName, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(person.sortName))
    .limit(500);
}

export const getPerson = (db: Db, id: number) => load(db, id);
