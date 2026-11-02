import {
  char,
  date,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { CITATION_SUBJECTS, SOURCE_TYPES } from '@civicscope/core';
import { softDelete, timestamps } from './columns';

/** One document (web page, filing, record) that backs one or more facts. */
export const source = mysqlTable(
  'source',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Normalized with normalizeSourceUrl from @civicscope/core. */
    url: varchar('url', { length: 2048 }).notNull(),
    /** URLs are too long for a unique index, so uniqueness is enforced on their hash. */
    urlHash: char('url_hash', { length: 64 })
      .notNull()
      .generatedAlwaysAs(sql`sha2(url, 256)`, { mode: 'stored' }),
    title: varchar('title', { length: 500 }).notNull(),
    publisher: varchar('publisher', { length: 200 }).notNull(),
    sourceType: mysqlEnum('source_type', SOURCE_TYPES).notNull(),
    publishedAt: date('published_at', { mode: 'string' }),
    /** The date someone last confirmed the document says what we cite it for. */
    retrievedAt: date('retrieved_at', { mode: 'string' }).notNull(),
    /** A permanent copy (e.g. web.archive.org), in case the original moves. */
    archiveUrl: varchar('archive_url', { length: 2048 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('source_url_hash_uq').on(t.urlHash),
    index('source_publisher_idx').on(t.publisher),
  ],
);

/**
 * Links a record (or one field of it) to the source that supports it.
 * Records cannot be published without at least one live citation.
 */
export const citation = mysqlTable(
  'citation',
  {
    id: int('id').autoincrement().primaryKey(),
    sourceId: int('source_id')
      .notNull()
      .references(() => source.id),
    subjectType: mysqlEnum('subject_type', CITATION_SUBJECTS).notNull(),
    subjectId: int('subject_id').notNull(),
    /** The field this supports, e.g. "fullName" or "status"; null means the record as a whole. */
    field: varchar('field', { length: 64 }),
    /** The words in the source that support the fact. */
    excerpt: varchar('excerpt', { length: 2000 }),
    /** Page, section or table within the document. */
    locator: varchar('locator', { length: 200 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    ...softDelete,
  },
  (t) => [
    index('citation_subject_idx').on(t.subjectType, t.subjectId),
    index('citation_source_idx').on(t.sourceId),
  ],
);
