import { index, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { PROMISE_RECORD_TYPES } from '@civicscope/core';
import { timestamps } from './columns';
import { claim } from './claims';

/**
 * An official record (a bill, a roll call, a state vote) that an editor set next to a
 * campaign promise, with a neutral note on how it relates. The link is part of the
 * promise's content: adding or removing one sends the promise back through review, and
 * it shows publicly only while the promise is published. record_id points at bill,
 * roll_call_vote or state_vote by record_type; the CMS checks the person is on it.
 */
export const promiseRecordLink = mysqlTable(
  'promise_record_link',
  {
    id: int('id').autoincrement().primaryKey(),
    claimId: int('claim_id')
      .notNull()
      .references(() => claim.id),
    recordType: mysqlEnum('record_type', PROMISE_RECORD_TYPES).notNull(),
    recordId: int('record_id').notNull(),
    /** In CivicScope's neutral words: what this record is, never a verdict on the promise. */
    note: varchar('note', { length: 500 }).notNull(),
    createdBy: int('created_by').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('promise_record_link_uq').on(t.claimId, t.recordType, t.recordId),
    index('promise_record_link_record_idx').on(t.recordType, t.recordId),
  ],
);
