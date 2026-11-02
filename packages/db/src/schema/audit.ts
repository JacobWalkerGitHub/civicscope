import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
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

/**
 * Full snapshot of a record after each saved change, so any earlier version can be
 * viewed and restored. Restoring writes a new version; history is never rewritten.
 */
export const revision = mysqlTable(
  'revision',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    version: int('version').notNull(),
    snapshot: json('snapshot').notNull(),
    /** Admin user ID, ingestion job key, or "system". */
    authorId: varchar('author_id', { length: 100 }).notNull(),
    note: varchar('note', { length: 1000 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('revision_entity_version_uq').on(t.entityType, t.entityId, t.version)],
);
