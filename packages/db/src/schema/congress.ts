import {
  bigint,
  boolean,
  char,
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
import { BILL_TYPES, CONGRESS_CHAMBERS, SPONSORSHIP_ROLES } from '@civicscope/core';
import { publishable, timestamps } from './columns';
import { source } from './sources';

/*
 * Congressional records imported from Congress.gov. Members are identified by their
 * Bioguide ID, not a person ID: a record reaches a CivicScope person through
 * person_identifier (scheme 'bioguide'), so fixing or merging a person's IDs re-links
 * their whole record without rewriting it. Each row keeps the source it came from and
 * the source's own "last updated" stamp, which is how re-runs skip unchanged records.
 */

const bioguideId = (name: string) => char(name, { length: 7 });
/** The source's updateDate, as given (e.g. "2025-09-09T18:53:19-04:00"). */
const sourceUpdatedAt = varchar('source_updated_at', { length: 40 }).notNull();

/** One member's seat in one chamber of one Congress. */
export const congressMembership = mysqlTable(
  'congress_membership',
  {
    id: int('id').autoincrement().primaryKey(),
    bioguideId: bioguideId('bioguide_id').notNull(),
    congress: smallint('congress').notNull(),
    chamber: mysqlEnum('chamber', CONGRESS_CHAMBERS).notNull(),
    /** USPS code; includes D.C. and territories, whose delegates sit in the House. */
    state: char('state', { length: 2 }).notNull(),
    /** House only; 0 for an at-large seat. */
    district: smallint('district'),
    partyName: varchar('party_name', { length: 100 }),
    startYear: smallint('start_year').notNull(),
    endYear: smallint('end_year'),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    sourceUpdatedAt,
    ...publishable,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('congress_membership_uq').on(t.bioguideId, t.congress, t.chamber),
    index('congress_membership_seat_idx').on(t.congress, t.chamber, t.state),
  ],
);

export const bill = mysqlTable(
  'bill',
  {
    id: int('id').autoincrement().primaryKey(),
    congress: smallint('congress').notNull(),
    billType: mysqlEnum('bill_type', BILL_TYPES).notNull(),
    number: int('number').notNull(),
    title: varchar('title', { length: 2000 }).notNull(),
    introducedOn: date('introduced_on', { mode: 'string' }),
    policyArea: varchar('policy_area', { length: 200 }),
    latestActionOn: date('latest_action_on', { mode: 'string' }),
    latestActionText: varchar('latest_action_text', { length: 2000 }),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    sourceUpdatedAt,
    ...publishable,
    ...timestamps,
  },
  (t) => [uniqueIndex('bill_uq').on(t.congress, t.billType, t.number)],
);

/** A member's sponsorship or cosponsorship of a bill, as Congress.gov lists it. */
export const billSponsorship = mysqlTable(
  'bill_sponsorship',
  {
    id: int('id').autoincrement().primaryKey(),
    billId: int('bill_id')
      .notNull()
      .references(() => bill.id),
    bioguideId: bioguideId('bioguide_id').notNull(),
    role: mysqlEnum('role', SPONSORSHIP_ROLES).notNull(),
    /** Cosponsors who signed on the day the bill was introduced. */
    isOriginal: boolean('is_original').notNull().default(false),
    sponsoredOn: date('sponsored_on', { mode: 'string' }),
    /** Cosponsors can withdraw; the record stays, with the date. */
    withdrawnOn: date('withdrawn_on', { mode: 'string' }),
    /** Party and state as the source recorded them at the time. */
    party: varchar('party', { length: 10 }),
    state: char('state', { length: 2 }),
  },
  (t) => [
    uniqueIndex('bill_sponsorship_uq').on(t.billId, t.bioguideId),
    index('bill_sponsorship_member_idx').on(t.bioguideId, t.role),
  ],
);

export const rollCallVote = mysqlTable(
  'roll_call_vote',
  {
    id: int('id').autoincrement().primaryKey(),
    chamber: mysqlEnum('chamber', CONGRESS_CHAMBERS).notNull(),
    congress: smallint('congress').notNull(),
    session: smallint('session').notNull(),
    rollNumber: int('roll_number').notNull(),
    /** When the vote started, in UTC. */
    votedAt: datetime('voted_at', { mode: 'date' }).notNull(),
    question: varchar('question', { length: 500 }),
    voteType: varchar('vote_type', { length: 100 }),
    result: varchar('result', { length: 100 }),
    /** The measure voted on, as the source names it (e.g. "HR", "3424"); empty for procedural votes. */
    legislationType: varchar('legislation_type', { length: 20 }),
    legislationNumber: varchar('legislation_number', { length: 20 }),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    sourceUpdatedAt,
    ...publishable,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('roll_call_vote_uq').on(t.chamber, t.congress, t.session, t.rollNumber),
    index('roll_call_vote_date_idx').on(t.votedAt),
  ],
);

/** How one member voted on one roll call. */
export const votePosition = mysqlTable(
  'vote_position',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    voteId: int('vote_id')
      .notNull()
      .references(() => rollCallVote.id),
    bioguideId: bioguideId('bioguide_id').notNull(),
    /** "Yea", "Nay", "Present", "Not Voting", or a name in a vote for Speaker. */
    voteCast: varchar('vote_cast', { length: 100 }).notNull(),
    /** Party and state as the Clerk recorded them for this vote. */
    party: varchar('party', { length: 10 }),
    state: char('state', { length: 2 }),
  },
  (t) => [
    uniqueIndex('vote_position_uq').on(t.voteId, t.bioguideId),
    index('vote_position_member_idx').on(t.bioguideId),
  ],
);
