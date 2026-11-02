import {
  date,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { CORRECTION_STATES, COVERAGE_LEVELS, OFFICE_LEVELS } from '@civicscope/core';
import { timestamps } from './columns';
import { adminUser } from './auth';
import { jurisdiction } from './geography';

/**
 * A reader's report that something on the site is wrong. Fixed requests with a public
 * note make up the public corrections log.
 */
export const correctionRequest = mysqlTable(
  'correction_request',
  {
    id: int('id').autoincrement().primaryKey(),
    state: mysqlEnum('state', CORRECTION_STATES).notNull().default('new'),
    /** The page the reader was on, e.g. /candidates/jane-doe. */
    pagePath: varchar('page_path', { length: 500 }),
    description: varchar('description', { length: 4000 }).notNull(),
    evidenceUrl: varchar('evidence_url', { length: 2048 }),
    /** Optional, only so an editor can reply. Never shown publicly. */
    contactEmail: varchar('contact_email', { length: 254 }),
    /** For rate limiting only. */
    ipAddress: varchar('ip_address', { length: 45 }),
    submittedAt: datetime('submitted_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    internalNote: varchar('internal_note', { length: 2000 }),
    /** What changed, in a sentence, for the public corrections log. */
    publicNote: varchar('public_note', { length: 1000 }),
    resolvedBy: int('resolved_by').references(() => adminUser.id),
    resolvedAt: datetime('resolved_at', { mode: 'date', fsp: 3 }),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index('correction_request_state_idx').on(t.state, t.submittedAt),
    index('correction_request_ip_idx').on(t.ipAddress, t.submittedAt),
    index('correction_request_log_idx').on(t.resolvedAt),
  ],
);

/**
 * How much of one state's races at one office level CivicScope covers in a cycle.
 * Drives the public Coverage page; anything without a row is not covered.
 */
export const coverageStatus = mysqlTable(
  'coverage_status',
  {
    id: int('id').autoincrement().primaryKey(),
    jurisdictionId: int('jurisdiction_id')
      .notNull()
      .references(() => jurisdiction.id),
    cycleYear: smallint('cycle_year').notNull(),
    officeLevel: mysqlEnum('office_level', OFFICE_LEVELS).notNull(),
    level: mysqlEnum('level', COVERAGE_LEVELS).notNull(),
    asOf: date('as_of', { mode: 'string' }),
    note: varchar('note', { length: 500 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('coverage_status_uq').on(t.jurisdictionId, t.cycleYear, t.officeLevel)],
);
