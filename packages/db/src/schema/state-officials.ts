import {
  char,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { STATE_OFFICE_ROLES } from '@civicscope/core';
import { publishable, timestamps } from './columns';
import { source } from './sources';

/*
 * Governors and state legislators in office, copied from Open States' public data
 * (data.openstates.org and the openstates/people repository), which is kept from each
 * state's official sites. Like the congressional tables, an officeholder is identified
 * by their Open States person ID; a CivicScope person carrying that ID
 * (person_identifier, scheme 'openstates') is linked, and nothing here is edited by hand.
 *
 * A row is one person in one office. Each import marks every row it sees with the day it
 * saw it (last_seen_on); a row the source no longer lists gets left_on and drops off the
 * public list, but is kept.
 */
export const stateOfficeholder = mysqlTable(
  'state_officeholder',
  {
    id: int('id').autoincrement().primaryKey(),
    /** "ocd-person/..." */
    osPersonId: varchar('os_person_id', { length: 80 }).notNull(),
    state: char('state', { length: 2 }).notNull(),
    role: mysqlEnum('role', STATE_OFFICE_ROLES).notNull(),
    /** As the state names it ("12", "Fairfax-3", "Hillsborough 14"); null for governors. */
    district: varchar('district', { length: 60 }),
    name: varchar('name', { length: 200 }).notNull(),
    /** "Family, Given" when the source gives both, else the name. */
    sortName: varchar('sort_name', { length: 200 }).notNull(),
    partyName: varchar('party_name', { length: 100 }),
    /** The officeholder's page on an official state site, when the source gives one. */
    officialUrl: varchar('official_url', { length: 500 }),
    /** Governors: the term as the source gives it. */
    termStart: date('term_start', { mode: 'string' }),
    termEnd: date('term_end', { mode: 'string' }),
    /** The file the row was read from. */
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    firstSeenOn: date('first_seen_on', { mode: 'string' }).notNull(),
    /** The last day an import found this person in this office: the "verified" date. */
    lastSeenOn: date('last_seen_on', { mode: 'string' }).notNull(),
    /** The first import that no longer found them, or null while they are listed. */
    leftOn: date('left_on', { mode: 'string' }),
    ...publishable,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('state_officeholder_uq').on(t.osPersonId, t.state, t.role),
    index('state_officeholder_seat_idx').on(t.state, t.role, t.leftOn),
  ],
);
