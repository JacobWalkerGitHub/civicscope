import {
  bigint,
  boolean,
  char,
  check,
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
import { CANDIDACY_STATUSES, PERSON_IDENTIFIER_SCHEMES } from '@civicscope/core';
import { publishable, softDelete, timestamps } from './columns';
import { race } from './elections';
import { party } from './parties';
import { source } from './sources';

/**
 * A real person who runs for or holds office. Deliberately has no party column:
 * party belongs to each candidacy, because people change parties.
 */
export const person = mysqlTable(
  'person',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 200 }).notNull(),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    preferredName: varchar('preferred_name', { length: 100 }),
    sortName: varchar('sort_name', { length: 200 }).notNull(),
    /** Only recorded when a source states it. */
    birthYear: smallint('birth_year'),
    ...publishable,
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('person_slug_uq').on(t.slug),
    index('person_sort_name_idx').on(t.sortName),
    check('person_birth_year_range', sql`${t.birthYear} IS NULL OR ${t.birthYear} >= 1900`),
  ],
);

/** IDs from other systems (FEC, Bioguide, ...). The main key for matching people across sources. */
export const personIdentifier = mysqlTable(
  'person_identifier',
  {
    id: int('id').autoincrement().primaryKey(),
    personId: int('person_id')
      .notNull()
      .references(() => person.id),
    scheme: mysqlEnum('scheme', PERSON_IDENTIFIER_SCHEMES).notNull(),
    value: varchar('value', { length: 100 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('person_identifier_scheme_value_uq').on(t.scheme, t.value),
    index('person_identifier_person_idx').on(t.personId),
  ],
);

/** One person running in one race. */
export const candidacy = mysqlTable(
  'candidacy',
  {
    id: int('id').autoincrement().primaryKey(),
    personId: int('person_id')
      .notNull()
      .references(() => person.id),
    raceId: int('race_id')
      .notNull()
      .references(() => race.id),
    /** The party label on the ballot, if any. */
    partyId: int('party_id').references(() => party.id),
    ballotName: varchar('ballot_name', { length: 200 }).notNull(),
    isIncumbent: boolean('is_incumbent').notNull().default(false),
    /** Latest status from candidacy_status_event, kept here for fast listing. */
    status: mysqlEnum('status', CANDIDACY_STATUSES),
    statusDate: date('status_date', { mode: 'string' }),
    campaignUrl: varchar('campaign_url', { length: 2048 }),
    fecCommitteeId: char('fec_committee_id', { length: 9 }),
    ...publishable,
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('candidacy_person_race_uq').on(t.personId, t.raceId),
    index('candidacy_race_idx').on(t.raceId),
  ],
);

/**
 * Dated, sourced history of a candidacy's status. Append-only (enforced by triggers):
 * a mistake is corrected by recording a new event, never by editing an old one.
 */
export const candidacyStatusEvent = mysqlTable(
  'candidacy_status_event',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    candidacyId: int('candidacy_id')
      .notNull()
      .references(() => candidacy.id),
    status: mysqlEnum('status', CANDIDACY_STATUSES).notNull(),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    note: varchar('note', { length: 500 }),
    /** Admin user ID, ingestion job key, or "system". */
    recordedBy: varchar('recorded_by', { length: 100 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('candidacy_status_event_idx').on(t.candidacyId, t.effectiveDate)],
);
