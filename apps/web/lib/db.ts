import 'server-only';
import { createDb, createPool, type Db } from '@civicscope/db';

const globalForDb = globalThis as unknown as { civicscopeDb?: Db };

/** One connection pool per server process (reused across hot reloads in development). */
export function getDb(): Db {
  if (!globalForDb.civicscopeDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set.');
    globalForDb.civicscopeDb = createDb(createPool(url));
  }
  return globalForDb.civicscopeDb;
}
