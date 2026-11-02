import { index, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { softDelete, timestamps } from './columns';
import { jurisdiction } from './geography';

/**
 * A political party. There is deliberately no color column: CivicScope never
 * signals party with color.
 */
export const party = mysqlTable(
  'party',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    shortName: varchar('short_name', { length: 50 }),
    /** FEC party code (DEM, REP, LIB, UN, W, ...), when the FEC uses one. */
    fecCode: varchar('fec_code', { length: 3 }),
    /** Null for national parties; set for state-only parties. */
    jurisdictionId: int('jurisdiction_id').references(() => jurisdiction.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('party_slug_uq').on(t.slug), index('party_fec_code_idx').on(t.fecCode)],
);
