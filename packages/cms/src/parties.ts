import { eq, isNull } from 'drizzle-orm';
import { partyInputSchema } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { NotFoundError } from './errors';
import { parseInput } from './parse';
import { uniqueSlug } from './slugs';

const { party } = schema;
export type Party = typeof party.$inferSelect;
export const PARTY_EDITABLE = ['name', 'shortName', 'fecCode', 'jurisdictionId'] as const;

async function load(tx: Tx | Db, id: number): Promise<Party> {
  const [row] = await tx.select().from(party).where(eq(party.id, id));
  if (!row) throw new NotFoundError('Party');
  return row;
}

export async function createParty(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(partyInputSchema, input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, party, party.slug, data.name);
    const [res] = await tx.insert(party).values({ ...data, slug });
    await recordChange(tx, actor, {
      entityType: 'party',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await load(tx, res.insertId),
    });
    return res.insertId;
  });
}

export async function updateParty(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(partyInputSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    await tx.update(party).set(data).where(eq(party.id, id));
    await recordChange(tx, actor, {
      entityType: 'party',
      entityId: id,
      action: opts.action ?? 'update',
      before,
      after: await load(tx, id),
      note: opts.note,
    });
  });
}

export async function setPartyArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    await tx
      .update(party)
      .set({ deletedAt: archived ? new Date() : null })
      .where(eq(party.id, id));
    await recordChange(tx, actor, {
      entityType: 'party',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listParties(db: Db, { includeArchived = false } = {}) {
  const query = db.select().from(party).orderBy(party.name);
  return includeArchived ? query : query.where(isNull(party.deletedAt));
}

export const getParty = (db: Db, id: number) => load(db, id);
