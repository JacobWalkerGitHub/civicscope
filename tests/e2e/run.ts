/**
 * End-to-end test runner: disposable MySQL + test users + Playwright.
 * Requires a production build of the web app (`pnpm --filter @civicscope/web build`).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createUser } from '@civicscope/auth';
import { startTestDatabase } from '@civicscope/db/testing';
import { E2E_PASSWORD, E2E_USERS } from './users';

const database = await startTestDatabase();
let exitCode: number;
try {
  for (const user of Object.values(E2E_USERS)) {
    await createUser(
      database.db,
      { ...user, password: E2E_PASSWORD },
      { type: 'system', id: 'e2e-setup' },
    );
  }

  const config = fileURLToPath(new URL('./playwright.config.ts', import.meta.url));
  exitCode = await new Promise<number>((resolve) => {
    const child = spawn(
      'pnpm',
      ['exec', 'playwright', 'test', '-c', config, ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, DATABASE_URL: database.url } },
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await database.stop();
}
process.exit(exitCode);
