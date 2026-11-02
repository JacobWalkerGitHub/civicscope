import { datetime, mysqlEnum } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { PUBLISH_STATES } from '@civicscope/core';

/** created_at / updated_at maintained by MySQL itself, so every writer gets them. */
export const timestamps = {
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
};

/** Soft delete: archived rows keep their history and are filtered out of public queries. */
export const softDelete = {
  deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
};

/** Records that the admin CMS can draft, publish, unpublish or archive. */
export const publishable = {
  publishState: mysqlEnum('publish_state', PUBLISH_STATES).notNull().default('draft'),
};
