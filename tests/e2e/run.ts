/**
 * End-to-end test runner: disposable MySQL + test users + Playwright.
 * Requires a production build of the web app (`pnpm --filter @civicscope/web build`).
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUser } from '@civicscope/auth';
import {
  applyAppGrants,
  createDb,
  createPool,
  seedIssues,
  seedJurisdictions,
} from '@civicscope/db';
import { startTestDatabase } from '@civicscope/db/testing';
import { E2E_PASSWORD, E2E_USERS } from './users';

const database = await startTestDatabase();
let exitCode: number;
try {
  await seedJurisdictions(database.db);
  await seedIssues(database.db);
  for (const user of Object.values(E2E_USERS)) {
    await createUser(
      database.db,
      { ...user, password: E2E_PASSWORD },
      { type: 'system', id: 'e2e-setup' },
    );
  }

  // Run the app as the least-privilege account production uses, so a write the
  // grants don't allow fails here rather than in production.
  const appPassword = randomBytes(18).toString('base64url');
  const rootPool = createPool(database.container.getConnectionUri(true));
  try {
    await applyAppGrants(createDb(rootPool), { user: 'civicscope_app', password: appPassword });
  } finally {
    await rootPool.end();
  }
  const appUrl = new URL(database.url);
  appUrl.username = 'civicscope_app';
  appUrl.password = appPassword;

  const config = fileURLToPath(new URL('./playwright.config.ts', import.meta.url));
  exitCode = await new Promise<number>((resolve) => {
    const child = spawn(
      'pnpm',
      ['exec', 'playwright', 'test', '-c', config, ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: appUrl.toString(),
          // The app runs as a production build, which needs a real encryption key.
          AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        },
      },
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await database.stop();
}
process.exit(exitCode);
