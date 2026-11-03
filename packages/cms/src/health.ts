import { sql } from 'drizzle-orm';
import type { Db } from '@civicscope/db';

/** Resolves when the database answers a trivial query within `timeoutMs`; rejects otherwise. */
export async function pingDatabase(db: Db, timeoutMs = 3000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database did not answer in time.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
