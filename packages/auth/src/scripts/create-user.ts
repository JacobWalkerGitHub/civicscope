/**
 * Creates an admin user from the command line. Used to bootstrap the first owner:
 *
 *   pnpm --filter @civicscope/auth create-user -- --email you@example.com --name "Your Name" --role owner
 *
 * The password is read from the ADMIN_PASSWORD environment variable if set,
 * otherwise prompted for (input hidden).
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { USER_ROLES, type UserRole } from '@civicscope/core';
import { createDb, createPool } from '@civicscope/db';
import { explainDatabaseError, requireDatabaseUrl } from '@civicscope/db/env';
import { createUser, UserInputError } from '../users';

/** Prompts for a password without echoing what is typed. */
function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const output = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'owner' },
  },
});

if (!values.email || !values.name) {
  console.error(
    'Usage: create-user --email <email> --name <name> [--role owner|reviewer|editor|viewer]',
  );
  process.exit(1);
}
if (!USER_ROLES.includes(values.role as UserRole)) {
  console.error(`Role must be one of: ${USER_ROLES.join(', ')}`);
  process.exit(1);
}
let url: string;
try {
  url = requireDatabaseUrl();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const password = process.env.ADMIN_PASSWORD ?? (await promptHidden('Password (12+ characters): '));
const pool = createPool(url);
try {
  const id = await createUser(
    createDb(pool),
    { email: values.email, name: values.name, password, role: values.role as UserRole },
    { type: 'system', id: 'cli:create-user' },
  );
  console.log(`Created ${values.role} ${values.email} (id ${id}).`);
} catch (error) {
  const message = error instanceof UserInputError ? error.message : explainDatabaseError(error);
  if (!message) throw error;
  console.error(message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
