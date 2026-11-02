import { and, asc, eq } from 'drizzle-orm';
import { LOCKABLE_FIELDS, type LockableEntity } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import type { Actor, Tx } from './changes';
import { diffRows } from './changes';
import { NotFoundError } from './errors';

const { fieldLock, adminUser } = schema;

/**
 * Locks every import-writable field that a manual edit changed, so later imports
 * can't silently undo it. Call inside the edit's transaction.
 */
export async function lockChangedFields(
  tx: Tx,
  actor: Actor,
  entityType: LockableEntity,
  entityId: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason = 'Changed by hand',
): Promise<string[]> {
  const changed = Object.keys(diffRows(before, after));
  const fields = (LOCKABLE_FIELDS[entityType] as readonly string[]).filter((f) =>
    changed.includes(f),
  );
  for (const field of fields) await lockField(tx, actor, entityType, entityId, field, reason);
  return fields;
}

export async function lockField(
  tx: Tx,
  actor: Actor,
  entityType: LockableEntity,
  entityId: number,
  field: string,
  reason: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: fieldLock.id })
    .from(fieldLock)
    .where(
      and(
        eq(fieldLock.entityType, entityType),
        eq(fieldLock.entityId, entityId),
        eq(fieldLock.field, field),
      ),
    );
  if (existing) return;
  const [res] = await tx
    .insert(fieldLock)
    .values({ entityType, entityId, field, lockedBy: actor.userId, reason });
  await recordAudit(tx, {
    actorType: 'user',
    actorId: String(actor.userId),
    action: 'create',
    entityType: 'field_lock',
    entityId: String(res.insertId),
    diff: { [`${entityType}.${entityId}.${field}`]: [null, 'locked'] },
    note: reason,
    ipAddress: actor.ipAddress ?? null,
  });
}

/** Unlocking lets the next import update the field again. */
export async function unlockField(db: Db, actor: Actor, lockId: number): Promise<void> {
  await db.transaction((tx) => removeLock(tx, actor, lockId, 'Unlocked'));
}

/** Removes a lock inside an existing transaction. */
export async function removeLock(tx: Tx, actor: Actor, lockId: number, note: string) {
  const [lock] = await tx.select().from(fieldLock).where(eq(fieldLock.id, lockId));
  if (!lock) throw new NotFoundError('Lock');
  await tx.delete(fieldLock).where(eq(fieldLock.id, lockId));
  await recordAudit(tx, {
    actorType: 'user',
    actorId: String(actor.userId),
    action: 'delete',
    entityType: 'field_lock',
    entityId: String(lockId),
    diff: { [`${lock.entityType}.${lock.entityId}.${lock.field}`]: ['locked', null] },
    note,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function lockedFields(
  tx: Tx | Db,
  entityType: LockableEntity,
  entityId: number,
): Promise<Set<string>> {
  const rows = await tx
    .select({ field: fieldLock.field })
    .from(fieldLock)
    .where(and(eq(fieldLock.entityType, entityType), eq(fieldLock.entityId, entityId)));
  return new Set(rows.map((r) => r.field));
}

export async function listLocks(db: Db, entityType: LockableEntity, entityId: number) {
  return db
    .select({
      id: fieldLock.id,
      field: fieldLock.field,
      reason: fieldLock.reason,
      createdAt: fieldLock.createdAt,
      lockedByName: adminUser.name,
    })
    .from(fieldLock)
    .leftJoin(adminUser, eq(adminUser.id, fieldLock.lockedBy))
    .where(and(eq(fieldLock.entityType, entityType), eq(fieldLock.entityId, entityId)))
    .orderBy(asc(fieldLock.field));
}
