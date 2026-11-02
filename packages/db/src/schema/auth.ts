import {
  bigint,
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
    /** Authenticator-app secret, encrypted with AES-256-GCM (see @civicscope/auth crypto). */
    totpSecret: varchar('totp_secret', { length: 255 }),
    /** Set once the user has confirmed a code; until then the secret is only pending. */
    totpEnabledAt: datetime('totp_enabled_at', { mode: 'date', fsp: 3 }),
    /** Last 30-second time step accepted, so a code can't be used twice. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('admin_user_email_uq').on(t.email)],
);

/** One-time codes for signing in without the authenticator app. Only hashes are stored. */
export const adminRecoveryCode = mysqlTable(
  'admin_recovery_code',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    codeHash: char('code_hash', { length: 64 }).notNull(),
    usedAt: datetime('used_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [index('admin_recovery_code_user_idx').on(t.userId)],
);

/**
 * An invitation to create an admin account. The link holds a random token; only its
 * hash is stored. Invitations expire and can be revoked.
 */
export const adminInvite = mysqlTable(
  'admin_invite',
  {
    id: int('id').autoincrement().primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    role: mysqlEnum('role', USER_ROLES).notNull(),
    invitedBy: int('invited_by').references(() => adminUser.id),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    acceptedAt: datetime('accepted_at', { mode: 'date', fsp: 3 }),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    uniqueIndex('admin_invite_token_uq').on(t.tokenHash),
    index('admin_invite_email_idx').on(t.email),
  ],
);

/**
 * The step between a correct password and a correct authenticator code. Short-lived,
 * limited attempts, and only the token's hash is stored.
 */
export const signInChallenge = mysqlTable(
  'sign_in_challenge',
  {
    id: char('id', { length: 64 }).primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    attempts: int('attempts').notNull().default(0),
    ipAddress: varchar('ip_address', { length: 45 }),
  },
  (t) => [index('sign_in_challenge_user_idx').on(t.userId)],
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
