import { and, eq, sql } from 'drizzle-orm';
import type { AuditAction } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Who is making a change. Every CMS write requires one. */
export interface Actor {
  userId: number;
  ipAddress?: string | null;
}

/** Bookkeeping columns that change on every write and are left out of diffs. */
const IGNORED = new Set(['createdAt', 'updatedAt']);

function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (IGNORED.has(key)) continue;
    const a = normalize(before?.[key]);
    const b = normalize(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = [a, b];
  }
  return out;
}

/**
 * Records one change: an audit-log entry with the field diff, and a full snapshot as
 * the next revision. Call inside the same transaction as the change itself.
 */
export async function recordChange(
  tx: Tx,
  actor: Actor,
  change: {
    entityType: string;
    entityId: number;
    action: AuditAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    note?: string | null;
  },
): Promise<number> {
  const entityId = String(change.entityId);
  await recordAudit(tx, {
    actorType: 'user',
    actorId: String(actor.userId),
    action: change.action,
    entityType: change.entityType,
    entityId,
    diff: diffRows(change.before, change.after),
    note: change.note ?? null,
    ipAddress: actor.ipAddress ?? null,
  });

  const [row] = await tx
    .select({ max: sql<number | null>`max(${schema.revision.version})` })
    .from(schema.revision)
    .where(
      and(
        eq(schema.revision.entityType, change.entityType),
        eq(schema.revision.entityId, entityId),
      ),
    );
  const version = Number(row?.max ?? 0) + 1;
  await tx.insert(schema.revision).values({
    entityType: change.entityType,
    entityId,
    version,
    snapshot: JSON.parse(JSON.stringify(change.after)),
    authorId: String(actor.userId),
    note: change.note ?? null,
  });
  return version;
}

/** Options for an update: restores are audited as "restore" with a note naming the version. */
export interface UpdateOptions {
  action?: 'update' | 'restore';
  note?: string;
}
