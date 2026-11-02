import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { UserRole } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { decryptSecret, encryptSecret } from './crypto';
import { createSession, hashToken, type CreatedSession, type SessionUser } from './sessions';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { UserInputError } from './users';

const { adminUser, adminRecoveryCode, signInChallenge, signInAttempt } = schema;

/** How long someone has to enter their code after a correct password. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

/**
 * Roles that must use two-step sign-in when ADMIN_REQUIRE_TWO_STEP is "true"
 * (set in production). These are the roles that can publish or manage users.
 */
export const TWO_STEP_REQUIRED_ROLES: readonly UserRole[] = ['owner', 'reviewer'];

export function twoStepRequired(role: UserRole, env = process.env): boolean {
  return env.ADMIN_REQUIRE_TWO_STEP === 'true' && TWO_STEP_REQUIRED_ROLES.includes(role);
}

const hashCode = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

/** "k7m2-x9qp-4fhw": 12 characters from an unambiguous alphabet (about 60 bits). */
function newRecoveryCode(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[randomInt(alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function loadUser(db: Db, userId: number) {
  const [user] = await db.select().from(adminUser).where(eq(adminUser.id, userId));
  if (!user) throw new UserInputError('User not found.');
  return user;
}

export async function twoStepStatus(db: Db, userId: number) {
  const user = await loadUser(db, userId);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(adminRecoveryCode)
    .where(and(eq(adminRecoveryCode.userId, userId), isNull(adminRecoveryCode.usedAt)));
  return { enabled: Boolean(user.totpEnabledAt), recoveryCodesLeft: Number(row?.n ?? 0) };
}

/**
 * Starts setup: stores a new pending secret and returns it with the link for the
 * authenticator app. Two-step isn't on until confirmTwoStepSetup succeeds.
 */
export async function beginTwoStepSetup(db: Db, userId: number) {
  const user = await loadUser(db, userId);
  if (user.totpEnabledAt) throw new UserInputError('Two-step sign-in is already on.');
  const secret = generateTotpSecret();
  await db
    .update(adminUser)
    .set({ totpSecret: encryptSecret(secret), totpLastStep: null })
    .where(eq(adminUser.id, userId));
  return { secret, url: otpauthUrl(user.email, secret) };
}

/** The pending secret, to show again if the setup page is reloaded. */
export async function pendingTwoStepSecret(db: Db, userId: number) {
  const user = await loadUser(db, userId);
  if (user.totpEnabledAt || !user.totpSecret) return null;
  const secret = decryptSecret(user.totpSecret);
  return { secret, url: otpauthUrl(user.email, secret) };
}

async function replaceRecoveryCodes(db: Db, userId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.delete(adminRecoveryCode).where(eq(adminRecoveryCode.userId, userId));
  await db
    .insert(adminRecoveryCode)
    .values(codes.map((code) => ({ userId, codeHash: hashCode(code) })));
  return codes;
}

/** Turns two-step on once the user proves their app works. Returns recovery codes, shown once. */
export async function confirmTwoStepSetup(
  db: Db,
  userId: number,
  code: string,
  meta: { ipAddress?: string | null } = {},
  now = new Date(),
): Promise<string[]> {
  const user = await loadUser(db, userId);
  if (user.totpEnabledAt) throw new UserInputError('Two-step sign-in is already on.');
  if (!user.totpSecret) throw new UserInputError('Start the setup again.');
  const step = verifyTotp(decryptSecret(user.totpSecret), code, now);
  if (step === null) {
    throw new UserInputError('That code didn’t match. Check the time on your phone and try again.');
  }
  await db
    .update(adminUser)
    .set({ totpEnabledAt: now, totpLastStep: step })
    .where(eq(adminUser.id, userId));
  await recordAudit(db, {
    actorType: 'user',
    actorId: String(userId),
    action: 'update',
    entityType: 'admin_user',
    entityId: userId,
    note: 'Turned on two-step sign-in',
    ipAddress: meta.ipAddress ?? null,
  });
  return replaceRecoveryCodes(db, userId);
}

/** New recovery codes replace the old ones; needs a current authenticator code. */
export async function regenerateRecoveryCodes(
  db: Db,
  userId: number,
  code: string,
  now = new Date(),
): Promise<string[]> {
  const user = await loadUser(db, userId);
  if (!user.totpEnabledAt || !user.totpSecret) throw new UserInputError('Two-step sign-in is off.');
  const step = verifyTotp(decryptSecret(user.totpSecret), code, now, user.totpLastStep);
  if (step === null) throw new UserInputError('That code didn’t match.');
  await db.update(adminUser).set({ totpLastStep: step }).where(eq(adminUser.id, userId));
  await recordAudit(db, {
    actorType: 'user',
    actorId: String(userId),
    action: 'update',
    entityType: 'admin_user',
    entityId: userId,
    note: 'Replaced recovery codes',
  });
  return replaceRecoveryCodes(db, userId);
}

/** Called by sign-in after a correct password, for users with two-step on. */
export async function createChallenge(
  db: Db,
  userId: number,
  ipAddress: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await db.delete(signInChallenge).where(eq(signInChallenge.userId, userId));
  await db.insert(signInChallenge).values({ id: hashToken(token), userId, expiresAt, ipAddress });
  return { token, expiresAt };
}

export type SecondFactorResult =
  | { ok: true; user: SessionUser; session: CreatedSession; usedRecoveryCode: boolean }
  | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Finishes sign-in with an authenticator code or a recovery code. Each wrong code
 * counts as a failed sign-in for lockout, and a challenge allows only a few tries.
 */
export async function completeSecondFactor(
  db: Db,
  input: {
    challengeToken: string;
    code: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  now = new Date(),
): Promise<SecondFactorResult> {
  const id = hashToken(input.challengeToken);
  const [challenge] = await db.select().from(signInChallenge).where(eq(signInChallenge.id, id));
  if (!challenge || challenge.expiresAt <= now || challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    if (challenge) await db.delete(signInChallenge).where(eq(signInChallenge.id, id));
    return { ok: false, reason: 'expired' };
  }
  const user = await loadUser(db, challenge.userId);
  if (user.disabledAt || !user.totpEnabledAt || !user.totpSecret) {
    await db.delete(signInChallenge).where(eq(signInChallenge.id, id));
    return { ok: false, reason: 'expired' };
  }

  const code = input.code.trim();
  let usedRecoveryCode = false;
  const step = verifyTotp(decryptSecret(user.totpSecret), code, now, user.totpLastStep);
  if (step !== null) {
    await db.update(adminUser).set({ totpLastStep: step }).where(eq(adminUser.id, user.id));
  } else {
    const [recovery] = await db
      .select()
      .from(adminRecoveryCode)
      .where(
        and(
          eq(adminRecoveryCode.userId, user.id),
          eq(adminRecoveryCode.codeHash, hashCode(code)),
          isNull(adminRecoveryCode.usedAt),
        ),
      );
    if (recovery) {
      await db
        .update(adminRecoveryCode)
        .set({ usedAt: now })
        .where(eq(adminRecoveryCode.id, recovery.id));
      usedRecoveryCode = true;
    } else {
      await db
        .update(signInChallenge)
        .set({ attempts: sql`${signInChallenge.attempts} + 1` })
        .where(eq(signInChallenge.id, id));
      await db.insert(signInAttempt).values({
        email: user.email,
        ipAddress: input.ipAddress ?? null,
        succeeded: false,
        attemptedAt: now,
      });
      return { ok: false, reason: 'invalid' };
    }
  }

  await db.delete(signInChallenge).where(eq(signInChallenge.id, id));
  await db.insert(signInAttempt).values({
    email: user.email,
    ipAddress: input.ipAddress ?? null,
    succeeded: true,
    attemptedAt: now,
  });
  await db.update(adminUser).set({ lastSignInAt: now }).where(eq(adminUser.id, user.id));
  await recordAudit(db, {
    actorType: 'user',
    actorId: String(user.id),
    action: 'sign_in',
    entityType: 'admin_user',
    entityId: user.id,
    note: usedRecoveryCode ? 'Signed in with a recovery code' : null,
    ipAddress: input.ipAddress ?? null,
  });
  const session = await createSession(
    db,
    user.id,
    { ipAddress: input.ipAddress, userAgent: input.userAgent },
    now,
  );
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoStep: Boolean(user.totpEnabledAt),
    },
    session,
    usedRecoveryCode,
  };
}
