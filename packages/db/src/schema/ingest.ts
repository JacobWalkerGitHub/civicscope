import {
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { INGEST_RUN_STATES, INGEST_SOURCES } from '@civicscope/core';
import { adminUser } from './auth';

/** One run of an automated connector: what it fetched, what it changed, what needs a person. */
export const ingestRun = mysqlTable(
  'ingest_run',
  {
    id: int('id').autoincrement().primaryKey(),
    source: mysqlEnum('source', INGEST_SOURCES).notNull(),
    /** What was asked for, e.g. { cycle: 2028 }. */
    params: json('params').notNull(),
    state: mysqlEnum('state', INGEST_RUN_STATES).notNull().default('running'),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
    /** Counts, and the records a person needs to look at. */
    summary: json('summary'),
    error: varchar('error', { length: 2000 }),
    /** The admin who started it by hand; null for scheduled runs. */
    startedBy: int('started_by').references(() => adminUser.id),
  },
  (t) => [index('ingest_run_source_idx').on(t.source, t.startedAt)],
);

/**
 * The raw response for each page a run fetched, kept so any imported value can be
 * traced to exactly what the source said. (Moves to S3 with the other files later.)
 */
export const ingestSnapshot = mysqlTable(
  'ingest_snapshot',
  {
    id: int('id').autoincrement().primaryKey(),
    runId: int('run_id')
      .notNull()
      .references(() => ingestRun.id),
    /** The request URL without credentials. */
    url: varchar('url', { length: 2048 }).notNull(),
    body: mediumtext('body').notNull(),
    fetchedAt: datetime('fetched_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('ingest_snapshot_run_idx').on(t.runId)],
);
