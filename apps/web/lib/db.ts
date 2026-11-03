import 'server-only';
import { createDb, createPool, databaseUrlFromEnv, type Db } from '@civicscope/db';

const globalForDb = globalThis as unknown as { civicscopeDb?: Db };

/** One connection pool per server process (reused across hot reloads in development). */
export function getDb(): Db {
  if (!globalForDb.civicscopeDb) {
    const url = databaseUrlFromEnv();
    if (!url)
      throw new Error('DATABASE_URL (or DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) is not set.');
    globalForDb.civicscopeDb = createDb(createPool(url));
  }
  return globalForDb.civicscopeDb;
}
