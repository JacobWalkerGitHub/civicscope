import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { USER_ROLES, type UserRole } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { hashPassword, passwordProblem } from './password';
import { hashToken } from './sessions';
import { normalizeEmail, UserInputError, type Actor } from './users';

const { adminInvite, adminUser } = schema;

/** Invitation links work for three days. */
export const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates an invitation and returns its token, to be put in a link the inviter sends.
 * The token is shown once; only its hash is stored. A new invitation for the same email
 * replaces any pending one.
 */
export async function createInvite(
  db: Db,
  input: { email: string; role: string },
  actor: Actor & { userId: number },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) throw new UserInputError('Enter a valid email address.');
  if (!USER_ROLES.includes(input.role as UserRole)) throw new UserInputError('Choose a role.');
  const role = input.role as UserRole;
  const [existing] = await db.select().from(adminUser).where(eq(adminUser.email, email));
  if (existing) throw new UserInputError('Someone with that email already has an account.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(adminInvite)
      .set({ revokedAt: now })
      .where(
        and(
          eq(adminInvite.email, email),
          isNull(adminInvite.acceptedAt),
          isNull(adminInvite.revokedAt),
        ),
      );
    const [res] = await tx.insert(adminInvite).values({
      tokenHash: hashToken(token),
      email,
      role,
      invitedBy: actor.userId,
      createdAt: now,
      expiresAt,
    });
    await recordAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'create',
      entityType: 'admin_invite',
      entityId: res.insertId,
      diff: { email: [null, email], role: [null, role] },
      ipAddress: actor.ipAddress ?? null,
    });
  });
  return { token, expiresAt };
}

/** The pending invitation for a token, or null if it is unknown, used, revoked or expired. */
export async function findInvite(db: Db, token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [invite] = await db
    .select()
    .from(adminInvite)
    .where(
      and(
        eq(adminInvite.tokenHash, hashToken(token)),
        isNull(adminInvite.acceptedAt),
        isNull(adminInvite.revokedAt),
        gt(adminInvite.expiresAt, now),
      ),
    );
  return invite ?? null;
}

/** Creates the account for an invitation. The email and role come from the invitation. */
export async function acceptInvite(
  db: Db,
  token: string,
  input: { name: string; password: string },
  meta: { ipAddress?: string | null } = {},
  now = new Date(),
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new UserInputError('Enter your name.');
  if (name.length > 200) throw new UserInputError('Keep your name under 200 characters.');
  const problem = passwordProblem(input.password);
  if (problem) throw new UserInputError(problem);
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const invite = await findInvite(tx as unknown as Db, token, now);
    if (!invite) throw new UserInputError('This invitation has expired or was already used.');
    const [taken] = await tx.select().from(adminUser).where(eq(adminUser.email, invite.email));
    if (taken) throw new UserInputError('An account with this email already exists.');
    const [res] = await tx
      .insert(adminUser)
      .values({ email: invite.email, name, passwordHash, role: invite.role });
    await tx.update(adminInvite).set({ acceptedAt: now }).where(eq(adminInvite.id, invite.id));
    await recordAudit(tx, {
      actorType: 'user',
      actorId: String(res.insertId),
      action: 'create',
      entityType: 'admin_user',
      entityId: res.insertId,
      diff: { email: [null, invite.email], name: [null, name], role: [null, invite.role] },
      note: `Accepted invitation ${invite.id}`,
      ipAddress: meta.ipAddress ?? null,
    });
    return res.insertId;
  });
}

export async function revokeInvite(db: Db, id: number, actor: Actor, now = new Date()) {
  await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(adminInvite).where(eq(adminInvite.id, id));
    if (!invite || invite.acceptedAt || invite.revokedAt) return;
    await tx.update(adminInvite).set({ revokedAt: now }).where(eq(adminInvite.id, id));
    await recordAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: 'delete',
      entityType: 'admin_invite',
      entityId: id,
      note: `Revoked invitation for ${invite.email}`,
      ipAddress: actor.ipAddress ?? null,
    });
  });
}

/** Invitations not yet accepted, revoked or expired. */
export async function listPendingInvites(db: Db, now = new Date()) {
  return db
    .select({
      id: adminInvite.id,
      email: adminInvite.email,
      role: adminInvite.role,
      createdAt: adminInvite.createdAt,
      expiresAt: adminInvite.expiresAt,
      invitedByName: adminUser.name,
    })
    .from(adminInvite)
    .leftJoin(adminUser, eq(adminUser.id, adminInvite.invitedBy))
    .where(
      and(
        isNull(adminInvite.acceptedAt),
        isNull(adminInvite.revokedAt),
        gt(adminInvite.expiresAt, now),
      ),
    )
    .orderBy(desc(adminInvite.createdAt));
}
