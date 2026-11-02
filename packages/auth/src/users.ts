import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { USER_ROLES, type UserRole } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { hashToken, invalidateUserSessions } from './sessions';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewUser {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}

export interface Actor {
  type: 'user' | 'system';
  id: string;
  ipAddress?: string | null;
}

export class UserInputError extends Error {}

export async function createUser(db: Db, input: NewUser, actor: Actor): Promise<number> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!EMAIL_PATTERN.test(email)) throw new UserInputError('Enter a valid email address.');
  if (name.length === 0) throw new UserInputError('Enter a name.');
  const problem = passwordProblem(input.password);
  if (problem) throw new UserInputError(problem);

  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.adminUser.id })
      .from(schema.adminUser)
      .where(eq(schema.adminUser.email, email));
    if (existing) throw new UserInputError('A user with that email already exists.');

    const [res] = await tx
      .insert(schema.adminUser)
      .values({ email, name, passwordHash, role: input.role });
    await recordAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'create',
      entityType: 'admin_user',
      entityId: res.insertId,
      diff: { email, name, role: input.role },
      ipAddress: actor.ipAddress ?? null,
    });
    return res.insertId;
  });
}

export async function listUsers(db: Db) {
  return db
    .select({
      id: schema.adminUser.id,
      email: schema.adminUser.email,
      name: schema.adminUser.name,
      role: schema.adminUser.role,
      disabledAt: schema.adminUser.disabledAt,
      lastSignInAt: schema.adminUser.lastSignInAt,
      totpEnabledAt: schema.adminUser.totpEnabledAt,
    })
    .from(schema.adminUser)
    .orderBy(schema.adminUser.name);
}

/** Who is changing another account; owners only (checked by the caller). */
export type UserAdminActor = Actor & { userId: number };

async function loadUser(db: Db, id: number) {
  const [user] = await db.select().from(schema.adminUser).where(eq(schema.adminUser.id, id));
  if (!user) throw new UserInputError('User not found.');
  return user;
}

/** There must always be at least one active owner, or nobody could manage users. */
async function assertAnotherActiveOwner(db: Db, exceptId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.adminUser)
    .where(
      and(
        eq(schema.adminUser.role, 'owner'),
        isNull(schema.adminUser.disabledAt),
        ne(schema.adminUser.id, exceptId),
      ),
    );
  if (Number(row?.n) === 0) {
    throw new UserInputError(
      'CivicScope needs at least one active owner. Make someone else an owner first.',
    );
  }
}

export async function changeUserRole(
  db: Db,
  userId: number,
  role: string,
  actor: UserAdminActor,
): Promise<void> {
  if (!USER_ROLES.includes(role as UserRole)) throw new UserInputError('Choose a role.');
  if (userId === actor.userId) throw new UserInputError('You can’t change your own role.');
  const user = await loadUser(db, userId);
  if (user.role === role) return;
  if (user.role === 'owner') await assertAnotherActiveOwner(db, userId);
  await db
    .update(schema.adminUser)
    .set({ role: role as UserRole })
    .where(eq(schema.adminUser.id, userId));
  // Sessions carry no role, but signing the user out makes the change take effect visibly.
  await invalidateUserSessions(db, userId);
  await recordAudit(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'role_change',
    entityType: 'admin_user',
    entityId: userId,
    diff: { role: [user.role, role] },
    ipAddress: actor.ipAddress ?? null,
  });
}

/** Disabling signs the user out everywhere at once; their history is kept. */
export async function setUserDisabled(
  db: Db,
  userId: number,
  disabled: boolean,
  actor: UserAdminActor,
): Promise<void> {
  if (userId === actor.userId) throw new UserInputError('You can’t disable your own account.');
  const user = await loadUser(db, userId);
  if (disabled && user.role === 'owner') await assertAnotherActiveOwner(db, userId);
  await db
    .update(schema.adminUser)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(schema.adminUser.id, userId));
  if (disabled) await invalidateUserSessions(db, userId);
  await recordAudit(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'update',
    entityType: 'admin_user',
    entityId: userId,
    note: disabled ? 'Disabled account' : 'Re-enabled account',
    ipAddress: actor.ipAddress ?? null,
  });
}

/**
 * For someone who lost their phone and recovery codes: turns two-step off so they can
 * set it up again. Signs them out everywhere.
 */
export async function resetUserTwoStep(
  db: Db,
  userId: number,
  actor: UserAdminActor,
): Promise<void> {
  if (userId === actor.userId) {
    throw new UserInputError('Ask another owner to reset your own two-step sign-in.');
  }
  await loadUser(db, userId);
  await db
    .update(schema.adminUser)
    .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null })
    .where(eq(schema.adminUser.id, userId));
  await db.delete(schema.adminRecoveryCode).where(eq(schema.adminRecoveryCode.userId, userId));
  await invalidateUserSessions(db, userId);
  await recordAudit(db, {
    actorType: actor.type,
    actorId: actor.id,
    action: 'update',
    entityType: 'admin_user',
    entityId: userId,
    note: 'Reset two-step sign-in',
    ipAddress: actor.ipAddress ?? null,
  });
}

/** Changes your own password. Signs out your other sessions. */
export async function changeOwnPassword(
  db: Db,
  userId: number,
  input: { current: string; next: string },
  keepSessionToken?: string,
): Promise<void> {
  const user = await loadUser(db, userId);
  if (!(await verifyPassword(user.passwordHash, input.current))) {
    throw new UserInputError('Your current password is incorrect.');
  }
  const problem = passwordProblem(input.next);
  if (problem) throw new UserInputError(problem);
  await db
    .update(schema.adminUser)
    .set({ passwordHash: await hashPassword(input.next) })
    .where(eq(schema.adminUser.id, userId));
  await db
    .delete(schema.adminSession)
    .where(
      and(
        eq(schema.adminSession.userId, userId),
        keepSessionToken ? ne(schema.adminSession.id, hashToken(keepSessionToken)) : undefined,
      ),
    );
  await recordAudit(db, {
    actorType: 'user',
    actorId: String(userId),
    action: 'update',
    entityType: 'admin_user',
    entityId: userId,
    note: 'Changed password',
  });
}
