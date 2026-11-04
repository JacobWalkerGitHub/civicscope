import {
  char,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { timestamps } from './columns';

/*
 * State legislative bills and floor votes, copied from Open States, which reads each
 * legislature's own website. Like the congressional tables, a legislator is identified
 * by their Open States person ID, not a person ID: a vote reaches a CivicScope person
 * through person_identifier (scheme 'openstates'), so fixing a person's IDs re-links
 * their record without rewriting it. Nothing here is edited by hand.
 */

const osId = (name: string) => varchar(name, { length: 80 });

export const stateBill = mysqlTable(
  'state_bill',
  {
    id: int('id').autoincrement().primaryKey(),
    /** "ocd-bill/..." */
    osId: osId('os_id').notNull(),
    state: char('state', { length: 2 }).notNull(),
    session: varchar('session', { length: 40 }).notNull(),
    /** As the legislature writes it, e.g. "HB 1105". */
    identifier: varchar('identifier', { length: 40 }).notNull(),
    title: varchar('title', { length: 2000 }).notNull(),
    latestActionOn: date('latest_action_on', { mode: 'string' }),
    latestActionText: varchar('latest_action_text', { length: 1000 }),
    openstatesUrl: varchar('openstates_url', { length: 500 }),
    /** The source's updated_at, as given. */
    sourceUpdatedAt: varchar('source_updated_at', { length: 40 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('state_bill_os_uq').on(t.osId),
    index('state_bill_state_idx').on(t.state, t.session),
  ],
);

export const stateVote = mysqlTable(
  'state_vote',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Open States' vote event ID. */
    osId: osId('os_id').notNull(),
    billId: int('bill_id')
      .notNull()
      .references(() => stateBill.id),
    chamber: mysqlEnum('chamber', ['upper', 'lower', 'legislature']).notNull(),
    motion: varchar('motion', { length: 500 }).notNull(),
    votedOn: date('voted_on', { mode: 'string' }).notNull(),
    /** "pass" or "fail", as the source gives it. */
    result: varchar('result', { length: 40 }).notNull(),
    yes: smallint('yes').notNull().default(0),
    no: smallint('no').notNull().default(0),
    other: smallint('other').notNull().default(0),
    /** The legislature's own page for the vote, where Open States gives one. */
    sourceUrl: varchar('source_url', { length: 1000 }),
  },
  (t) => [uniqueIndex('state_vote_os_uq').on(t.osId), index('state_vote_bill_idx').on(t.billId)],
);

/** How one legislator voted on one state vote. */
export const stateVotePosition = mysqlTable(
  'state_vote_position',
  {
    id: int('id').autoincrement().primaryKey(),
    voteId: int('vote_id')
      .notNull()
      .references(() => stateVote.id),
    /** "ocd-person/...", or null when Open States could not tell who the name is. */
    osPersonId: osId('os_person_id'),
    /** The name as the legislature printed it on the roll call. */
    voterName: varchar('voter_name', { length: 200 }).notNull(),
    /** "yes", "no", "absent", "abstain", "not voting", "excused", "other". */
    option: varchar('option', { length: 40 }).notNull(),
  },
  (t) => [
    uniqueIndex('state_vote_position_uq').on(t.voteId, t.voterName),
    index('state_vote_position_person_idx').on(t.osPersonId),
  ],
);

/** Where each state's bill import left off, so a run continues the last one. */
export const stateVoteCursor = mysqlTable('state_vote_cursor', {
  state: char('state', { length: 2 }).primaryKey(),
  /** Bills updated at or after this time are read next. */
  updatedSince: varchar('updated_since', { length: 40 }).notNull(),
  /** The page of that listing to read next. */
  page: int('page').notNull().default(1),
});
