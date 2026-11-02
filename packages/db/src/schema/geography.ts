import {
  type AnyMySqlColumn,
  boolean,
  char,
  check,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import {
  DISTRICT_TYPES,
  JURISDICTION_TYPES,
  LEGISLATIVE_CHAMBERS,
  OFFICE_BRANCHES,
  OFFICE_LEVELS,
} from '@civicscope/core';
import { softDelete, timestamps } from './columns';

/**
 * Any place that holds elections: the country, states and DC now; counties, cities
 * and school districts later. Self-referencing tree via parent_id.
 */
export const jurisdiction = mysqlTable(
  'jurisdiction',
  {
    id: int('id').autoincrement().primaryKey(),
    parentId: int('parent_id').references((): AnyMySqlColumn => jurisdiction.id),
    type: mysqlEnum('type', JURISDICTION_TYPES).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Two-letter postal code for states, DC and territories. */
    uspsCode: char('usps_code', { length: 2 }),
    /** Census FIPS code (2 digits for states, 5 for counties). */
    fips: varchar('fips', { length: 5 }),
    /** Census ANSI/GNIS feature code (STATENS for states). */
    ansiCode: varchar('ansi_code', { length: 8 }),
    /** Open Civic Data division ID, the shared key across civic data sources. */
    ocdId: varchar('ocd_id', { length: 255 }).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('jurisdiction_ocd_id_uq').on(t.ocdId),
    uniqueIndex('jurisdiction_usps_code_uq').on(t.uspsCode),
    index('jurisdiction_parent_idx').on(t.parentId),
    check('jurisdiction_root_is_country', sql`(${t.type} = 'country') = (${t.parentId} IS NULL)`),
  ],
);

/**
 * An electoral district. Districts are versioned by validity dates because
 * redistricting can change a district between cycles.
 */
export const district = mysqlTable(
  'district',
  {
    id: int('id').autoincrement().primaryKey(),
    jurisdictionId: int('jurisdiction_id')
      .notNull()
      .references(() => jurisdiction.id),
    type: mysqlEnum('type', DISTRICT_TYPES).notNull(),
    /** District number or name as the state uses it ("7", "At-Large", "Middlesex 2"). */
    label: varchar('label', { length: 50 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    ocdId: varchar('ocd_id', { length: 255 }).notNull(),
    /** The redistricting plan that drew this version of the district. */
    planName: varchar('plan_name', { length: 200 }),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('district_ocd_valid_from_uq').on(t.ocdId, t.validFrom),
    index('district_jurisdiction_type_idx').on(t.jurisdictionId, t.type),
    check('district_valid_range', sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`),
  ],
);

/** A public office, e.g. "Governor of Kentucky" or "Virginia House of Delegates". */
export const office = mysqlTable(
  'office',
  {
    id: int('id').autoincrement().primaryKey(),
    jurisdictionId: int('jurisdiction_id')
      .notNull()
      .references(() => jurisdiction.id),
    slug: varchar('slug', { length: 200 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    level: mysqlEnum('level', OFFICE_LEVELS).notNull(),
    branch: mysqlEnum('branch', OFFICE_BRANCHES).notNull(),
    chamber: mysqlEnum('chamber', LEGISLATIVE_CHAMBERS),
    /** Number of seats per district (or statewide) elected to this office. */
    seats: int('seats').notNull().default(1),
    termYears: tinyint('term_years'),
    isPartisan: boolean('is_partisan').notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('office_slug_uq').on(t.slug),
    index('office_jurisdiction_idx').on(t.jurisdictionId),
    check('office_seats_positive', sql`${t.seats} >= 1`),
    check(
      'office_term_years_range',
      sql`${t.termYears} IS NULL OR ${t.termYears} BETWEEN 1 AND 20`,
    ),
    check(
      'office_chamber_only_for_legislative',
      sql`${t.chamber} IS NULL OR ${t.branch} = 'legislative'`,
    ),
  ],
);
