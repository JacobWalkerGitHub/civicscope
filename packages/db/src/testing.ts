/**
 * Test helper: starts a disposable MySQL 8.4 container with all migrations applied.
 * Not for production code.
 */
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import type { Pool } from 'mysql2/promise';
import { createDb, createPool, type Db } from './client';
import { runMigrations } from './migrate';

export interface TestDatabase {
  container: StartedMySqlContainer;
  pool: Pool;
  db: Db;
  url: string;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  // RDS needs log_bin_trust_function_creators=1 in its parameter group so the
  // (non-SUPER) migration user can create the audit-log triggers; mirror it here.
  const container = await new MySqlContainer('mysql:8.4')
    .withCommand(['--log-bin-trust-function-creators=1'])
    .start();
  const url = container.getConnectionUri();
  const pool = createPool(url);
  const db = createDb(pool);
  await runMigrations(db);
  return {
    container,
    pool,
    db,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
