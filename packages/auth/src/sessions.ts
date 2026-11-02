import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { UserRole } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';

/** Admin sessions last 12 hours, then the user signs in again. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  userId: number,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  now = new Date(),
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(schema.adminSession).values({
    id: hashToken(token),
    userId,
    createdAt: now,
    expiresAt,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
  });
  return { token, expiresAt };
}

/** Returns the signed-in user for a session token, or null if it is unknown, expired or disabled. */
export async function validateSession(
  db: Db,
  token: string | undefined | null,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({
      id: schema.adminUser.id,
      email: schema.adminUser.email,
      name: schema.adminUser.name,
      role: schema.adminUser.role,
      disabledAt: schema.adminUser.disabledAt,
      expiresAt: schema.adminSession.expiresAt,
    })
    .from(schema.adminSession)
    .innerJoin(schema.adminUser, eq(schema.adminSession.userId, schema.adminUser.id))
    .where(
      and(eq(schema.adminSession.id, hashToken(token)), gt(schema.adminSession.expiresAt, now)),
    );

  if (!row || row.disabledAt) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.delete(schema.adminSession).where(eq(schema.adminSession.id, hashToken(token)));
}

export async function invalidateUserSessions(db: Db, userId: number): Promise<void> {
  await db.delete(schema.adminSession).where(eq(schema.adminSession.userId, userId));
}

export async function deleteExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.delete(schema.adminSession).where(lt(schema.adminSession.expiresAt, now));
}
