import { eq } from 'drizzle-orm';
import type { UserRole } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { hashPassword, passwordProblem } from './password';

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
    })
    .from(schema.adminUser)
    .orderBy(schema.adminUser.name);
}
