import {
  boolean,
  char,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { USER_ROLES } from '@civicscope/core';
import { timestamps } from './columns';

/** An admin CMS account. The public site has no accounts. */
export const adminUser = mysqlTable(
  'admin_user',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Stored lowercased and trimmed. */
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Argon2id hash (PHC string). */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: mysqlEnum('role', USER_ROLES).notNull().default('viewer'),
    /** Disabled users cannot sign in and their sessions stop working immediately. */
    disabledAt: datetime('disabled_at', { mode: 'date', fsp: 3 }),
    lastSignInAt: datetime('last_sign_in_at', { mode: 'date', fsp: 3 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('admin_user_email_uq').on(t.email)],
);

/**
 * Server-side sessions. The browser holds a random token; only its SHA-256 hash is
 * stored, so a leaked database cannot be used to hijack sessions.
 */
export const adminSession = mysqlTable(
  'admin_session',
  {
    /** Hex SHA-256 of the session token. */
    id: char('id', { length: 64 }).primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
  },
  (t) => [
    index('admin_session_user_idx').on(t.userId),
    index('admin_session_expires_idx').on(t.expiresAt),
  ],
);

/** Every sign-in attempt, used to lock out repeated failures and for review. */
export const signInAttempt = mysqlTable(
  'sign_in_attempt',
  {
    id: int('id').autoincrement().primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    succeeded: boolean('succeeded').notNull(),
    attemptedAt: datetime('attempted_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index('sign_in_attempt_email_idx').on(t.email, t.attemptedAt),
    index('sign_in_attempt_ip_idx').on(t.ipAddress, t.attemptedAt),
  ],
);
