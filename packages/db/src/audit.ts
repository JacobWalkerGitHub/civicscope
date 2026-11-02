import type { AuditAction, AuditActorType } from '@civicscope/core';
import { auditLog } from './schema/index';
import type { Db } from './client';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AuditEntry {
  actorType: AuditActorType;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | number;
  diff?: unknown;
  note?: string | null;
  ipAddress?: string | null;
}

/** Appends one entry to the audit log. Pass a transaction so the entry commits with the change. */
export async function recordAudit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    ...entry,
    entityId: String(entry.entityId),
    diff: entry.diff ?? null,
    note: entry.note ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
