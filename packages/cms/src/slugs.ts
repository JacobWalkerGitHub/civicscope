import { eq } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import { slugify } from '@civicscope/core';
import type { Tx } from './changes';

/** A slug not yet used in the table: "governor-of-kentucky", then "-2", "-3"... */
export async function uniqueSlug(
  tx: Tx,
  table: MySqlTable,
  column: MySqlColumn,
  text: string,
): Promise<string> {
  const base = slugify(text) || 'item';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await tx.select({ c: column }).from(table).where(eq(column, candidate)).limit(1);
    if (taken.length === 0) return candidate;
  }
  throw new Error(`Could not find a free slug for "${text}"`);
}
