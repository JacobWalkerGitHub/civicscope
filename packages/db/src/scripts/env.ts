import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { databaseUrlFromEnv } from '../client';

/**
 * Loads the repository's root .env file (if there is one) so command-line scripts
 * work without exporting variables by hand. Variables already set in the
 * environment win over the file.
 */
export function loadRootEnv(start = process.cwd()): void {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const file = join(dir, '.env');
      if (existsSync(file)) process.loadEnvFile(file);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireDatabaseUrl(): string {
  loadRootEnv();
  const url = databaseUrlFromEnv();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Run `cp .env.example .env` in the project folder, or set DATABASE_URL.',
    );
  }
  return url;
}

/** Turns "can't connect" errors into a plain next step; other errors pass through. */
export function explainDatabaseError(error: unknown): string | null {
  let e: unknown = error;
  while (e && typeof e === 'object') {
    const code = (e as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return 'Cannot reach the MySQL database. Is Docker running? Start the database with `docker compose up -d mysql`, wait about 20 seconds, and try again.';
    }
    if (code === 'ER_ACCESS_DENIED_ERROR') {
      return 'MySQL rejected the username or password in DATABASE_URL (check your .env file).';
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** Runs a CLI entry point, printing friendly database errors instead of stack traces. */
export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    const friendly = explainDatabaseError(error);
    if (!friendly) throw error;
    console.error(friendly);
    process.exitCode = 1;
  }
}
