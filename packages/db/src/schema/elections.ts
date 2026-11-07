import {
  boolean,
  check,
  date,
  datetime,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import {
  ELECTION_DEADLINE_KINDS,
  ELECTION_TYPES,
  GENERAL_ELECTION_TYPES,
  OFFICIAL_RESOURCE_KINDS,
  PARTISAN_PRIMARY_SYSTEMS,
  PRIMARY_ELECTION_TYPES,
  PRIMARY_SYSTEMS,
  RACE_STATUSES,
} from '@civicscope/core';
import { publishable, softDelete, timestamps } from './columns';
import { district, jurisdiction, office } from './geography';
import { party } from './parties';

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));

/** A calendar year of elections, e.g. 2027 (off-year state races) or 2028. */
export const electionCycle = mysqlTable(
  'election_cycle',
  {
    id: int('id').autoincrement().primaryKey(),
    year: smallint('year').notNull(),
    label: varchar('label', { length: 100 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('election_cycle_year_uq').on(t.year),
    check('election_cycle_year_range', sql`${t.year} BETWEEN 1789 AND 2200`),
  ],
);

/** One election day in one jurisdiction, e.g. "Kentucky general election, Nov 2, 2027". */
export const election = mysqlTable(
  'election',
  {
    id: int('id').autoincrement().primaryKey(),
    cycleId: int('cycle_id')
      .notNull()
      .references(() => electionCycle.id),
    jurisdictionId: int('jurisdiction_id')
      .notNull()
      .references(() => jurisdiction.id),
    type: mysqlEnum('type', ELECTION_TYPES).notNull(),
    primarySystem: mysqlEnum('primary_system', PRIMARY_SYSTEMS).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    officialUrl: varchar('official_url', { length: 2048 }),
    ...publishable,
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('election_jurisdiction_type_date_uq').on(t.jurisdictionId, t.type, t.date),
    // Target of race's composite foreign key, which lets race CHECK its party rule.
    unique('election_id_type_system_uq').on(t.id, t.type, t.primarySystem),
    index('election_cycle_idx').on(t.cycleId),
    index('election_date_idx').on(t.date),
    check(
      'election_primary_system_matches_type',
      sql`(${t.type} IN (${sqlList(GENERAL_ELECTION_TYPES)})) = (${t.primarySystem} = 'not_applicable')`,
    ),
  ],
);

/**
 * A single contest on a ballot: one office (and district) in one election.
 * A partisan primary is one race per party.
 *
 * election_type and primary_system are copies of the parent election's values,
 * kept in sync by a composite foreign key, so the database itself can enforce
 * the party rule (see racePartyRule in @civicscope/core).
 */
export const race = mysqlTable(
  'race',
  {
    id: int('id').autoincrement().primaryKey(),
    electionId: int('election_id').notNull(),
    electionType: mysqlEnum('election_type', ELECTION_TYPES).notNull(),
    primarySystem: mysqlEnum('primary_system', PRIMARY_SYSTEMS).notNull(),
    officeId: int('office_id')
      .notNull()
      .references(() => office.id),
    districtId: int('district_id').references(() => district.id),
    partyId: int('party_id').references(() => party.id),
    name: varchar('name', { length: 200 }).notNull(),
    seats: int('seats').notNull().default(1),
    isSpecial: boolean('is_special').notNull().default(false),
    status: mysqlEnum('status', RACE_STATUSES).notNull().default('scheduled'),
    /**
     * The day the winner takes office, as an official source states it (the state
     * constitution, a statute, or the election authority). Never worked out by CivicScope,
     * so it is only shown with the source it came from.
     */
    termStartsOn: date('term_starts_on', { mode: 'string' }),
    termStartSourceUrl: varchar('term_start_source_url', { length: 2048 }),
    /**
     * Identifies the contest for uniqueness. MySQL treats NULLs as distinct in unique
     * indexes, so a plain unique index on the nullable district/party columns would
     * allow two identical statewide races.
     */
    contestKey: varchar('contest_key', { length: 80 })
      .notNull()
      .generatedAlwaysAs(
        sql`concat_ws('-', election_id, office_id, ifnull(district_id, 0), ifnull(party_id, 0), is_special)`,
        { mode: 'stored' },
      ),
    ...publishable,
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      name: 'race_election_fk',
      columns: [t.electionId, t.electionType, t.primarySystem],
      foreignColumns: [election.id, election.type, election.primarySystem],
    }),
    uniqueIndex('race_contest_uq').on(t.contestKey),
    index('race_election_idx').on(t.electionId),
    index('race_office_idx').on(t.officeId),
    index('race_district_idx').on(t.districtId),
    check('race_seats_positive', sql`${t.seats} >= 1`),
    check(
      'race_term_start_sourced',
      sql`(${t.termStartsOn} IS NULL) = (${t.termStartSourceUrl} IS NULL)`,
    ),
    check(
      'race_party_rule',
      sql`(${t.partyId} IS NOT NULL) = (${t.electionType} IN (${sqlList(PRIMARY_ELECTION_TYPES)}) AND ${t.primarySystem} IN (${sqlList(PARTISAN_PRIMARY_SYSTEMS)}))`,
    ),
  ],
);

/** Dates that matter for an election (filing, registration, early voting...). Always sourced. */
export const electionDeadline = mysqlTable(
  'election_deadline',
  {
    id: int('id').autoincrement().primaryKey(),
    electionId: int('election_id')
      .notNull()
      .references(() => election.id),
    kind: mysqlEnum('kind', ELECTION_DEADLINE_KINDS).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
    ...timestamps,
  },
  (t) => [index('election_deadline_election_idx').on(t.electionId, t.date)],
);

/** Links to official election authorities and resources for a jurisdiction. */
export const officialResource = mysqlTable(
  'official_resource',
  {
    id: int('id').autoincrement().primaryKey(),
    jurisdictionId: int('jurisdiction_id')
      .notNull()
      .references(() => jurisdiction.id),
    kind: mysqlEnum('kind', OFFICIAL_RESOURCE_KINDS).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    lastCheckedAt: datetime('last_checked_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('official_resource_jurisdiction_idx').on(t.jurisdictionId, t.kind)],
);
