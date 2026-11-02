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
import { USER_ROLES, type UserRole } from '@civicscope/core';
import { createDb, createPool } from '@civicscope/db';
import { createUser, UserInputError } from '../users';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, s);
    };
    rl.question(question, (answer) => {
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
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
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
  if (error instanceof UserInputError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await pool.end();
}
