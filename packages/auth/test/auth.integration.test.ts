import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  createSession,
  createUser,
  hashToken,
  invalidateSession,
  invalidateUserSessions,
  MAX_FAILURES_PER_EMAIL,
  SESSION_TTL_MS,
  signIn,
  UserInputError,
  validateSession,
} from '../src/index';

let test: TestDatabase;
let db: Db;
const system = { type: 'system' as const, id: 'test' };
const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
});
afterAll(async () => {
  await test?.stop();
});

describe('createUser', () => {
  it('stores a normalized email, an argon2id hash and an audit entry', async () => {
    const id = await createUser(
      db,
      { email: '  Owner@Example.COM ', name: 'Owner', password: PASSWORD, role: 'owner' },
      system,
    );
    const [user] = await db.select().from(schema.adminUser).where(eq(schema.adminUser.id, id));
    expect(user?.email).toBe('owner@example.com');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, 'admin_user'));
    expect(audit.some((a) => a.action === 'create' && a.entityId === String(id))).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('rejects duplicates, short passwords and bad emails', async () => {
    const base = { name: 'X', password: PASSWORD, role: 'viewer' as const };
    await expect(createUser(db, { ...base, email: 'OWNER@example.com' }, system)).rejects.toThrow(
      UserInputError,
    );
    await expect(
      createUser(db, { ...base, email: 'short@example.com', password: 'tooshort' }, system),
    ).rejects.toThrow(/at least 12/);
    await expect(createUser(db, { ...base, email: 'not-an-email' }, system)).rejects.toThrow(
      /valid email/,
    );
  });
});

describe('signIn', () => {
  it('signs in with the right password and returns a working session', async () => {
    const result = await signIn(db, {
      email: 'owner@example.com',
      password: PASSWORD,
      ipAddress: '10.0.0.1',
    });
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.user.role).toBe('owner');
    expect(await validateSession(db, result.session.token)).toMatchObject({
      email: 'owner@example.com',
    });

    // Only a hash of the token is stored.
    const sessions = await db.select().from(schema.adminSession);
    expect(sessions.map((s) => s.id)).toContain(hashToken(result.session.token));
    expect(sessions.map((s) => s.id)).not.toContain(result.session.token);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await signIn(db, { email: 'owner@example.com', password: 'wrong password!!' });
    const unknown = await signIn(db, { email: 'nobody@example.com', password: PASSWORD });
    expect(wrong).toEqual({ ok: false, reason: 'invalid' });
    expect(unknown).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks an email after repeated failures, even for the right password', async () => {
    await createUser(
      db,
      { email: 'lock@example.com', name: 'Lock', password: PASSWORD, role: 'editor' },
      system,
    );
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      expect(await signIn(db, { email: 'lock@example.com', password: 'nope nope nope' })).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await signIn(db, { email: 'lock@example.com', password: PASSWORD })).toEqual({
      ok: false,
      reason: 'locked',
    });

    // The lock lifts once the window has passed.
    const later = new Date(Date.now() + 16 * 60 * 1000);
    const result = await signIn(db, { email: 'lock@example.com', password: PASSWORD }, later);
    expect(result.ok).toBe(true);
  });

  it('refuses disabled users and ends their sessions', async () => {
    const id = await createUser(
      db,
      { email: 'gone@example.com', name: 'Gone', password: PASSWORD, role: 'editor' },
      system,
    );
    const { token } = await createSession(db, id);
    expect(await validateSession(db, token)).not.toBeNull();

    await db
      .update(schema.adminUser)
      .set({ disabledAt: new Date() })
      .where(eq(schema.adminUser.id, id));
    expect(await validateSession(db, token)).toBeNull();
    expect(await signIn(db, { email: 'gone@example.com', password: PASSWORD })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('sessions', () => {
  it('expire after the session lifetime', async () => {
    const [owner] = await db
      .select()
      .from(schema.adminUser)
      .where(eq(schema.adminUser.email, 'owner@example.com'));
    const { token } = await createSession(db, owner!.id);
    expect(await validateSession(db, token)).not.toBeNull();
    expect(
      await validateSession(db, token, new Date(Date.now() + SESSION_TTL_MS + 1000)),
    ).toBeNull();
  });

  it('end on sign-out and on "sign out everywhere"', async () => {
    const [owner] = await db
      .select()
      .from(schema.adminUser)
      .where(eq(schema.adminUser.email, 'owner@example.com'));
    const a = await createSession(db, owner!.id);
    const b = await createSession(db, owner!.id);
    await invalidateSession(db, a.token);
    expect(await validateSession(db, a.token)).toBeNull();
    expect(await validateSession(db, b.token)).not.toBeNull();
    await invalidateUserSessions(db, owner!.id);
    expect(await validateSession(db, b.token)).toBeNull();
  });

  it('reject garbage tokens', async () => {
    expect(await validateSession(db, undefined)).toBeNull();
    expect(await validateSession(db, '')).toBeNull();
    expect(await validateSession(db, 'x'.repeat(5000))).toBeNull();
    expect(await validateSession(db, 'not-a-real-token')).toBeNull();
  });
});
