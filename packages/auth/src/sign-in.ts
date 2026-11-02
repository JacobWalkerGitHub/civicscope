import { and, eq, gt, sql } from 'drizzle-orm';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { getDummyHash, MAX_PASSWORD_LENGTH, verifyPassword } from './password';
import { createSession, type CreatedSession, type SessionUser } from './sessions';
import { createChallenge } from './two-step';
import { normalizeEmail } from './users';

/** Lockout policy: too many failures in this window block further attempts. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

export type SignInResult =
  | { ok: true; user: SessionUser; session: CreatedSession }
  /** Password was right; the user must now enter an authenticator or recovery code. */
  | { ok: 'two_step'; challenge: { token: string; expiresAt: Date } }
  | { ok: false; reason: 'invalid' | 'locked' };

export interface SignInInput {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function recentFailures(db: Db, column: 'email' | 'ip', value: string, since: Date) {
  const target = column === 'email' ? schema.signInAttempt.email : schema.signInAttempt.ipAddress;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.signInAttempt)
    .where(
      and(
        eq(target, value),
        eq(schema.signInAttempt.succeeded, false),
        gt(schema.signInAttempt.attemptedAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Checks credentials and starts a session. Messages never reveal whether an email
 * exists; lockouts are counted per email and per IP address.
 */
export async function signIn(db: Db, input: SignInInput, now = new Date()): Promise<SignInResult> {
  const email = normalizeEmail(input.email).slice(0, 254);
  const ipAddress = input.ipAddress ?? null;
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);

  const locked =
    (await recentFailures(db, 'email', email, since)) >= MAX_FAILURES_PER_EMAIL ||
    (ipAddress !== null &&
      (await recentFailures(db, 'ip', ipAddress, since)) >= MAX_FAILURES_PER_IP);

  const record = (succeeded: boolean) =>
    db.insert(schema.signInAttempt).values({ email, ipAddress, succeeded, attemptedAt: now });

  if (locked) {
    await record(false);
    return { ok: false, reason: 'locked' };
  }

  const [user] = await db.select().from(schema.adminUser).where(eq(schema.adminUser.email, email));
  const password = input.password.slice(0, MAX_PASSWORD_LENGTH + 1);
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !passwordOk || user.disabledAt) {
    await record(false);
    return { ok: false, reason: 'invalid' };
  }

  if (user.totpEnabledAt) {
    // Not a completed sign-in yet: the attempt is recorded once the code checks out.
    return { ok: 'two_step', challenge: await createChallenge(db, user.id, ipAddress, now) };
  }

  await record(true);
  await db
    .update(schema.adminUser)
    .set({ lastSignInAt: now })
    .where(eq(schema.adminUser.id, user.id));
  await recordAudit(db, {
    actorType: 'user',
    actorId: String(user.id),
    action: 'sign_in',
    entityType: 'admin_user',
    entityId: user.id,
    ipAddress,
  });
  const session = await createSession(db, user.id, { ipAddress, userAgent: input.userAgent }, now);
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
  };
}
