import {
  bigint,
  datetime,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { AUDIT_ACTIONS, AUDIT_ACTOR_TYPES } from '@civicscope/core';

/**
 * Append-only record of every change. Triggers (see the custom migration) reject
 * UPDATE and DELETE on this table, so history cannot be rewritten through the app.
 */
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    actorType: mysqlEnum('actor_type', AUDIT_ACTOR_TYPES).notNull(),
    /** User ID, ingestion job key, or "system". */
    actorId: varchar('actor_id', { length: 100 }).notNull(),
    action: mysqlEnum('action', AUDIT_ACTIONS).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    /** Changed fields as { field: [before, after] }. */
    diff: json('diff'),
    note: varchar('note', { length: 1000 }),
    ipAddress: varchar('ip_address', { length: 45 }),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('audit_log_actor_idx').on(t.actorType, t.actorId, t.occurredAt),
  ],
);
