import {
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { CONFLICT_STATES, IMPORT_KINDS, IMPORT_STATES } from '@civicscope/core';
import { adminUser } from './auth';
import { race } from './elections';
import { source } from './sources';

const createdAt = datetime('created_at', { mode: 'date', fsp: 3 })
  .notNull()
  .default(sql`CURRENT_TIMESTAMP(3)`);

/**
 * A field someone changed by hand. Imports and ingestion may not overwrite it; when
 * their source says something different, a conflict opens in the review queue.
 */
export const fieldLock = mysqlTable(
  'field_lock',
  {
    id: int('id').autoincrement().primaryKey(),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: int('entity_id').notNull(),
    field: varchar('field', { length: 64 }).notNull(),
    lockedBy: int('locked_by')
      .notNull()
      .references(() => adminUser.id),
    reason: varchar('reason', { length: 200 }).notNull(),
    createdAt,
  },
  (t) => [uniqueIndex('field_lock_uq').on(t.entityType, t.entityId, t.field)],
);

/**
 * An uploaded CSV. It is checked and previewed from the stored text as many times as
 * needed, then applied in one transaction (or discarded). The source applies to every
 * row, so each imported fact is cited.
 */
export const importBatch = mysqlTable(
  'import_batch',
  {
    id: int('id').autoincrement().primaryKey(),
    kind: mysqlEnum('kind', IMPORT_KINDS).notNull(),
    state: mysqlEnum('state', IMPORT_STATES).notNull().default('preview'),
    raceId: int('race_id')
      .notNull()
      .references(() => race.id),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    csvText: mediumtext('csv_text').notNull(),
    /** The source as entered at upload (URL, title, publisher, type, date). */
    sourceRef: json('source_ref').notNull(),
    /** Set when applied: the source every imported row is cited to. */
    sourceId: int('source_id').references(() => source.id),
    /** Counts by outcome, recorded when applied. */
    summary: json('summary'),
    createdBy: int('created_by')
      .notNull()
      .references(() => adminUser.id),
    createdAt,
    closedBy: int('closed_by').references(() => adminUser.id),
    closedAt: datetime('closed_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [index('import_batch_state_idx').on(t.state, t.createdAt)],
);

/**
 * Something an import could not apply on its own. For now one kind: the source gives
 * a different value for a locked field. A reviewer accepts the source's value or keeps
 * the current one.
 */
export const reviewItem = mysqlTable(
  'review_item',
  {
    id: int('id').autoincrement().primaryKey(),
    kind: mysqlEnum('kind', ['field_conflict']).notNull(),
    state: mysqlEnum('state', CONFLICT_STATES).notNull().default('open'),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: int('entity_id').notNull(),
    field: varchar('field', { length: 64 }).notNull(),
    currentValue: json('current_value'),
    proposedValue: json('proposed_value'),
    /** Extra values needed to apply the proposal, e.g. the status date. */
    detail: json('detail'),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    importBatchId: int('import_batch_id').references(() => importBatch.id),
    createdAt,
    resolvedBy: int('resolved_by').references(() => adminUser.id),
    resolvedAt: datetime('resolved_at', { mode: 'date', fsp: 3 }),
    resolutionNote: varchar('resolution_note', { length: 500 }),
  },
  (t) => [
    index('review_item_state_idx').on(t.state, t.createdAt),
    index('review_item_entity_idx').on(t.entityType, t.entityId),
  ],
);
