import {
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
import {
  BIO_CATEGORIES,
  CLAIM_KINDS,
  CONTENT_KINDS,
  POSITION_TYPES,
  VERIFICATION_STATUSES,
} from '@civicscope/core';
import { publishable, softDelete, timestamps } from './columns';
import { person } from './candidates';

/** Policy areas that positions are filed under (economy, health care, ...). */
export const issue = mysqlTable(
  'issue',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('issue_slug_uq').on(t.slug)],
);

/**
 * One sourced entry on a candidate's profile: a position, a biography item or an
 * accomplishment. Publishing needs a citation and a reviewer's approval.
 */
export const claim = mysqlTable(
  'claim',
  {
    id: int('id').autoincrement().primaryKey(),
    personId: int('person_id')
      .notNull()
      .references(() => person.id),
    kind: mysqlEnum('kind', CLAIM_KINDS).notNull(),
    /** Where the content comes from; shown to readers next to the entry. */
    contentKind: mysqlEnum('content_kind', CONTENT_KINDS).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    /** Neutral summary in CivicScope's words. */
    summary: varchar('summary', { length: 2000 }).notNull(),
    /** The person's exact words, when quoting them. */
    quote: varchar('quote', { length: 2000 }),
    issueId: int('issue_id').references(() => issue.id),
    positionType: mysqlEnum('position_type', POSITION_TYPES),
    bioCategory: mysqlEnum('bio_category', BIO_CATEGORIES),
    organization: varchar('organization', { length: 200 }),
    /** When it was said or happened. */
    statedOn: date('stated_on', { mode: 'string' }),
    venue: varchar('venue', { length: 200 }),
    startYear: smallint('start_year'),
    endYear: smallint('end_year'),
    verificationStatus: mysqlEnum('verification_status', VERIFICATION_STATUSES)
      .notNull()
      .default('unverified'),
    /** Who last changed the content, so a reviewer can't approve their own edits. */
    lastEditedBy: int('last_edited_by'),
    submittedAt: datetime('submitted_at', { mode: 'date', fsp: 3 }),
    reviewNote: varchar('review_note', { length: 1000 }),
    verifiedAt: datetime('verified_at', { mode: 'date', fsp: 3 }),
    verifiedBy: int('verified_by'),
    ...publishable,
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('claim_person_idx').on(t.personId, t.kind),
    index('claim_review_idx').on(t.verificationStatus, t.submittedAt),
    index('claim_issue_idx').on(t.issueId),
    check(
      'claim_position_fields',
      sql`(${t.kind} = 'position') = (${t.issueId} IS NOT NULL AND ${t.positionType} IS NOT NULL)`,
    ),
    check('claim_bio_fields', sql`(${t.kind} = 'biography') = (${t.bioCategory} IS NOT NULL)`),
    check(
      'claim_year_order',
      sql`${t.startYear} IS NULL OR ${t.endYear} IS NULL OR ${t.endYear} >= ${t.startYear}`,
    ),
    check(
      'claim_published_is_verified',
      sql`${t.publishState} <> 'published' OR ${t.verificationStatus} IN ('verified', 'disputed', 'outdated')`,
    ),
  ],
);
