import {
  char,
  date,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { RESULT_GROUPS } from '@civicscope/core';

/*
 * Unofficial election-night results, copied from each state's own results file. These
 * tables mirror the source and are replaced as it changes; nothing here is edited by a
 * person, and no race is "called". Certified results are a separate, later step.
 */

/** One state's official results file for one election day. */
export const resultFeed = mysqlTable(
  'result_feed',
  {
    id: int('id').autoincrement().primaryKey(),
    state: char('state', { length: 2 }).notNull(),
    electionDate: date('election_date', { mode: 'string' }).notNull(),
    /** Which parser reads it, e.g. "ncsbe" or "fl-dos". */
    kind: varchar('kind', { length: 20 }).notNull(),
    sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
    /** Where people can see the same results on the state's own site. */
    publicUrl: varchar('public_url', { length: 2048 }),
    /** SHA-256 of the last body read, so an unchanged file is not reloaded. */
    bodyHash: char('body_hash', { length: 64 }),
    /** Last successful read. */
    fetchedAt: datetime('fetched_at', { mode: 'date', fsp: 3 }),
    /** Last time the numbers changed. */
    changedAt: datetime('changed_at', { mode: 'date', fsp: 3 }),
    /** Last read that failed, cleared by the next success. */
    error: varchar('error', { length: 1000 }),
  },
  (t) => [uniqueIndex('result_feed_state_date_uq').on(t.state, t.electionDate)],
);

export const resultContest = mysqlTable(
  'result_contest',
  {
    id: int('id').autoincrement().primaryKey(),
    feedId: int('feed_id')
      .notNull()
      .references(() => resultFeed.id),
    /** The source's own ID for the contest, stable between reads. */
    sourceKey: varchar('source_key', { length: 191 }).notNull(),
    name: varchar('name', { length: 300 }).notNull(),
    group: mysqlEnum('group', RESULT_GROUPS).notNull(),
    voteFor: smallint('vote_for').notNull().default(1),
    precinctsTotal: int('precincts_total'),
    precinctsReporting: int('precincts_reporting'),
    totalVotes: int('total_votes').notNull().default(0),
    /** Order within its group, as the state lists it. */
    sort: int('sort').notNull().default(0),
  },
  (t) => [
    uniqueIndex('result_contest_source_uq').on(t.feedId, t.sourceKey),
    index('result_contest_group_idx').on(t.feedId, t.group, t.sort),
  ],
);

export const resultCandidate = mysqlTable(
  'result_candidate',
  {
    id: int('id').autoincrement().primaryKey(),
    contestId: int('contest_id')
      .notNull()
      .references(() => resultContest.id),
    /** Name plus party, as the source gives them; stable between reads. */
    key: varchar('key', { length: 191 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** The party label from the ballot, shown as text only. */
    party: varchar('party', { length: 60 }),
    votes: int('votes').notNull().default(0),
  },
  (t) => [uniqueIndex('result_candidate_key_uq').on(t.contestId, t.key)],
);

/** One county (or other reporting unit) of a contest, where the state reports them. */
export const resultArea = mysqlTable(
  'result_area',
  {
    id: int('id').autoincrement().primaryKey(),
    contestId: int('contest_id')
      .notNull()
      .references(() => resultContest.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    precinctsTotal: int('precincts_total'),
    precinctsReporting: int('precincts_reporting'),
    /** Votes by candidate key. */
    votes: json('votes').$type<Record<string, number>>().notNull(),
  },
  (t) => [uniqueIndex('result_area_code_uq').on(t.contestId, t.code)],
);
