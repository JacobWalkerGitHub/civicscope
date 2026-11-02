import { and, eq, isNull } from 'drizzle-orm';
import { officeInputSchema } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { NotFoundError } from './errors';
import { parseInput } from './parse';
import { uniqueSlug } from './slugs';

const { office, jurisdiction } = schema;
export type Office = typeof office.$inferSelect;
export const OFFICE_EDITABLE = [
  'jurisdictionId',
  'title',
  'level',
  'branch',
  'chamber',
  'seats',
  'termYears',
  'isPartisan',
] as const;

async function load(tx: Tx | Db, id: number): Promise<Office> {
  const [row] = await tx.select().from(office).where(eq(office.id, id));
  if (!row) throw new NotFoundError('Office');
  return row;
}

export async function createOffice(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(officeInputSchema, input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, office, office.slug, data.title);
    const [res] = await tx.insert(office).values({ ...data, slug });
    await recordChange(tx, actor, {
      entityType: 'office',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await load(tx, res.insertId),
    });
    return res.insertId;
  });
}

export async function updateOffice(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(officeInputSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    await tx.update(office).set(data).where(eq(office.id, id));
    await recordChange(tx, actor, {
      entityType: 'office',
      entityId: id,
      action: opts.action ?? 'update',
      before,
      after: await load(tx, id),
      note: opts.note,
    });
  });
}

export async function setOfficeArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    await tx
      .update(office)
      .set({ deletedAt: archived ? new Date() : null })
      .where(eq(office.id, id));
    await recordChange(tx, actor, {
      entityType: 'office',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listOffices(db: Db, { jurisdictionId }: { jurisdictionId?: number } = {}) {
  return db
    .select({
      id: office.id,
      title: office.title,
      level: office.level,
      branch: office.branch,
      chamber: office.chamber,
      seats: office.seats,
      jurisdictionId: office.jurisdictionId,
      jurisdictionName: jurisdiction.name,
      deletedAt: office.deletedAt,
    })
    .from(office)
    .innerJoin(jurisdiction, eq(office.jurisdictionId, jurisdiction.id))
    .where(
      and(
        isNull(office.deletedAt),
        jurisdictionId ? eq(office.jurisdictionId, jurisdictionId) : undefined,
      ),
    )
    .orderBy(jurisdiction.name, office.title);
}

export const getOffice = (db: Db, id: number) => load(db, id);
