import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  acceptInvite,
  beginTwoStepSetup,
  changeOwnPassword,
  changeUserRole,
  completeSecondFactor,
  confirmTwoStepSetup,
  createInvite,
  createSession,
  createUser,
  findInvite,
  listPendingInvites,
  MAX_CHALLENGE_ATTEMPTS,
  regenerateRecoveryCodes,
  resetUserTwoStep,
  revokeInvite,
  setUserDisabled,
  signIn,
  totpCode,
  totpStep,
  twoStepRequired,
  twoStepStatus,
  UserInputError,
  validateSession,
} from '../src/index';

let test: TestDatabase;
let db: Db;
const PASSWORD = 'correct horse battery staple';
const system = { type: 'system' as const, id: 'test' };
let ownerId: number;
let ownerActor: { type: 'user'; id: string; userId: number };

async function newUser(email: string, role: 'owner' | 'reviewer' | 'editor' | 'viewer') {
  return createUser(db, { email, name: email.split('@')[0]!, password: PASSWORD, role }, system);
}

/** A code from a later step than any used so far, so replay protection doesn't reject it. */
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  ownerId = await newUser('owner@test.local', 'owner');
  ownerActor = { type: 'user', id: String(ownerId), userId: ownerId };
});
afterAll(async () => {
  await test?.stop();
});

describe('two-step sign-in', () => {
  let userId: number;
  let secret: string;
  let recovery: string[];

  it('needs a working code from the app before it turns on', async () => {
    userId = await newUser('two-step@test.local', 'reviewer');
    ({ secret } = await beginTwoStepSetup(db, userId));
    const [row] = await db.select().from(schema.adminUser).where(eq(schema.adminUser.id, userId));
    expect(row!.totpSecret).not.toContain(secret); // encrypted at rest
    await expect(confirmTwoStepSetup(db, userId, '000000')).rejects.toThrow(UserInputError);
    expect((await twoStepStatus(db, userId)).enabled).toBe(false);

    recovery = await confirmTwoStepSetup(db, userId, totpCode(secret, totpStep(new Date())));
    expect(recovery).toHaveLength(10);
    expect(await twoStepStatus(db, userId)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('asks for a code after the password, and only then starts a session', async () => {
    const now = at(2);
    const first = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, now);
    expect(first.ok).toBe('two_step');
    if (first.ok !== 'two_step') return;
    const sessions = await db.select().from(schema.adminSession);
    expect(sessions.filter((s) => s.userId === userId)).toHaveLength(0);

    const wrong = await completeSecondFactor(
      db,
      { challengeToken: first.challenge.token, code: '123456' },
      now,
    );
    expect(wrong).toEqual({ ok: false, reason: 'invalid' });

    const code = totpCode(secret, totpStep(now));
    const done = await completeSecondFactor(
      db,
      { challengeToken: first.challenge.token, code },
      now,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect((await validateSession(db, done.session.token))?.id).toBe(userId);

    // The same code can't be used again, even with a fresh challenge.
    const again = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, now);
    if (again.ok !== 'two_step') throw new Error('expected a challenge');
    const replay = await completeSecondFactor(
      db,
      { challengeToken: again.challenge.token, code },
      now,
    );
    expect(replay.ok).toBe(false);
  });

  it('accepts each recovery code once', async () => {
    const now = at(4);
    const run = async () => {
      const r = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, now);
      if (r.ok !== 'two_step') throw new Error('expected a challenge');
      return completeSecondFactor(
        db,
        { challengeToken: r.challenge.token, code: recovery[0]! },
        now,
      );
    };
    const used = await run();
    expect(used.ok && used.usedRecoveryCode).toBe(true);
    expect((await run()).ok).toBe(false);
    expect((await twoStepStatus(db, userId)).recoveryCodesLeft).toBe(9);
  });

  it('gives up on a challenge after too many wrong codes, or once it expires', async () => {
    const now = at(6);
    const r = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, now);
    if (r.ok !== 'two_step') throw new Error('expected a challenge');
    for (let i = 0; i < MAX_CHALLENGE_ATTEMPTS; i++) {
      await completeSecondFactor(db, { challengeToken: r.challenge.token, code: '000000' }, now);
    }
    const good = totpCode(secret, totpStep(now));
    expect(
      await completeSecondFactor(db, { challengeToken: r.challenge.token, code: good }, now),
    ).toEqual({ ok: false, reason: 'expired' });

    // Wrong codes count toward the account lockout, so the account is now locked.
    expect((await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, now)).ok).toBe(
      false,
    );

    const later = at(30);
    const r2 = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, later);
    if (r2.ok !== 'two_step') throw new Error('expected a challenge');
    const tooLate = new Date(later.getTime() + 6 * 60_000);
    expect(
      await completeSecondFactor(
        db,
        { challengeToken: r2.challenge.token, code: totpCode(secret, totpStep(tooLate)) },
        tooLate,
      ),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('replaces recovery codes only with a current code', async () => {
    await expect(regenerateRecoveryCodes(db, userId, '000000', at(40))).rejects.toThrow();
    const codes = await regenerateRecoveryCodes(
      db,
      userId,
      totpCode(secret, totpStep(at(40))),
      at(40),
    );
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain(recovery[1]);
  });

  it('can be reset by an owner, which signs the user out', async () => {
    const { token } = await createSession(db, userId);
    await expect(resetUserTwoStep(db, ownerId, ownerActor)).rejects.toThrow(/another owner/);
    await resetUserTwoStep(db, userId, ownerActor);
    expect((await twoStepStatus(db, userId)).enabled).toBe(false);
    expect(await validateSession(db, token)).toBeNull();
    const r = await signIn(db, { email: 'two-step@test.local', password: PASSWORD }, at(60));
    expect(r.ok).toBe(true);
  });

  it('is required only for publishing roles, and only when turned on', () => {
    const on = { ADMIN_REQUIRE_TWO_STEP: 'true' };
    expect(twoStepRequired('owner', on)).toBe(true);
    expect(twoStepRequired('reviewer', on)).toBe(true);
    expect(twoStepRequired('editor', on)).toBe(false);
    expect(twoStepRequired('owner', {})).toBe(false);
  });
});

describe('invitations', () => {
  it('creates an account with the invited email and role, once', async () => {
    const { token } = await createInvite(
      db,
      { email: ' New@Test.local ', role: 'editor' },
      ownerActor,
    );
    expect((await listPendingInvites(db)).map((i) => i.email)).toContain('new@test.local');
    await expect(acceptInvite(db, token, { name: 'New', password: 'short' })).rejects.toThrow(
      /at least 12/,
    );
    const id = await acceptInvite(db, token, { name: 'New Editor', password: PASSWORD });
    const [user] = await db.select().from(schema.adminUser).where(eq(schema.adminUser.id, id));
    expect([user!.email, user!.role]).toEqual(['new@test.local', 'editor']);
    await expect(acceptInvite(db, token, { name: 'Again', password: PASSWORD })).rejects.toThrow(
      /expired or was already used/,
    );
  });

  it('refuses existing accounts, and can be revoked or expire', async () => {
    await expect(
      createInvite(db, { email: 'owner@test.local', role: 'editor' }, ownerActor),
    ).rejects.toThrow(/already has an account/);
    const a = await createInvite(db, { email: 'later@test.local', role: 'viewer' }, ownerActor);
    const [pending] = (await listPendingInvites(db)).filter((i) => i.email === 'later@test.local');
    await revokeInvite(db, pending!.id, ownerActor);
    expect(await findInvite(db, a.token)).toBeNull();

    const b = await createInvite(db, { email: 'late@test.local', role: 'viewer' }, ownerActor);
    expect(await findInvite(db, b.token, new Date(Date.now() + 4 * 24 * 3600_000))).toBeNull();
  });
});

describe('managing users', () => {
  it('changes roles, but never leaves CivicScope without an owner', async () => {
    const editorId = await newUser('promote@test.local', 'editor');
    await changeUserRole(db, editorId, 'reviewer', ownerActor);
    await expect(changeUserRole(db, ownerId, 'editor', ownerActor)).rejects.toThrow(/own role/);

    const otherOwner = await newUser('owner2@test.local', 'owner');
    const otherActor = { type: 'user' as const, id: String(otherOwner), userId: otherOwner };
    await changeUserRole(db, ownerId, 'reviewer', otherActor);
    await expect(changeUserRole(db, otherOwner, 'editor', ownerActor)).rejects.toThrow();
    await changeUserRole(db, ownerId, 'owner', otherActor);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'role_change'));
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('disables an account, ending its sessions at once', async () => {
    const id = await newUser('disable@test.local', 'editor');
    const { token } = await createSession(db, id);
    await expect(setUserDisabled(db, ownerId, true, ownerActor)).rejects.toThrow(/your own/);
    await setUserDisabled(db, id, true, ownerActor);
    expect(await validateSession(db, token)).toBeNull();
    expect((await signIn(db, { email: 'disable@test.local', password: PASSWORD })).ok).toBe(false);
    await setUserDisabled(db, id, false, ownerActor);
    expect((await signIn(db, { email: 'disable@test.local', password: PASSWORD })).ok).toBe(true);
  });

  it('changes your own password and signs out your other sessions', async () => {
    const id = await newUser('pw@test.local', 'viewer');
    const keep = await createSession(db, id);
    const other = await createSession(db, id);
    await expect(
      changeOwnPassword(db, id, { current: 'wrong password!', next: 'a brand new password' }),
    ).rejects.toThrow(/incorrect/);
    await changeOwnPassword(
      db,
      id,
      { current: PASSWORD, next: 'a brand new password' },
      keep.token,
    );
    expect(await validateSession(db, keep.token)).not.toBeNull();
    expect(await validateSession(db, other.token)).toBeNull();
    expect(
      (await signIn(db, { email: 'pw@test.local', password: 'a brand new password' })).ok,
    ).toBe(true);
  });
});
