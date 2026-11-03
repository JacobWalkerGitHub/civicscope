/**
 * Checks for the backup restore drill: is a restored database complete and usable?
 * Kept out of the package index, like migrate.ts, because it reads migration files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { MIGRATIONS_FOLDER } from './migrate';

export interface TableFingerprint {
  table: string;
  rows: number;
  /** MySQL's CHECKSUM TABLE: equal on two servers when the rows are identical. */
  checksum: string | null;
}

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const [result] = (await db.execute(query)) as unknown as [T[]];
  return result;
}

/** Row count and checksum of every table in the connected database, by name. */
export async function fingerprintDatabase(db: Db): Promise<TableFingerprint[]> {
  const tables = await rows<{ name: string }>(
    db,
    sql`select table_name as name from information_schema.tables
        where table_schema = database() and table_type = 'BASE TABLE' order by table_name`,
  );
  const out: TableFingerprint[] = [];
  for (const { name } of tables) {
    // Table names come from information_schema, not from input; still quote them.
    const ident = sql.identifier(name);
    const [count] = await rows<{ n: number }>(db, sql`select count(*) as n from ${ident}`);
    const [sum] = await rows<{ Checksum: string | number | null }>(
      db,
      sql`checksum table ${ident}`,
    );
    out.push({
      table: name,
      rows: Number(count!.n),
      checksum: sum?.Checksum == null ? null : String(sum.Checksum),
    });
  }
  return out;
}

/** Tables that differ between two fingerprints, with a plain description of how. */
export function compareFingerprints(source: TableFingerprint[], restored: TableFingerprint[]) {
  const differences: string[] = [];
  const byName = new Map(restored.map((t) => [t.table, t]));
  for (const s of source) {
    const r = byName.get(s.table);
    if (!r) differences.push(`${s.table}: missing from the restored database`);
    else if (r.rows !== s.rows)
      differences.push(`${s.table}: ${s.rows} rows, restored has ${r.rows}`);
    else if (r.checksum !== s.checksum)
      differences.push(`${s.table}: same row count, different contents`);
    byName.delete(s.table);
  }
  for (const extra of byName.keys()) differences.push(`${extra}: only in the restored database`);
  return differences;
}

/**
 * Checks a restored database on its own: every migration recorded, the tables the
 * site cannot work without are present and non-empty, and no published entry has lost
 * its citations.
 */
export async function checkRestoredDatabase(db: Db): Promise<string[]> {
  const problems: string[] = [];
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const [applied] = await rows<{ n: number }>(
    db,
    sql`select count(*) as n from __drizzle_migrations`,
  ).catch(() => [{ n: -1 }]);
  if (Number(applied!.n) !== journal.entries.length) {
    problems.push(
      `Migrations: ${applied!.n} recorded, this code has ${journal.entries.length}. ` +
        'Restore a newer backup or run `pnpm db:migrate` on the restored copy.',
    );
  }
  for (const table of ['jurisdiction', 'admin_user']) {
    const [r] = await rows<{ n: number }>(
      db,
      sql`select count(*) as n from ${sql.identifier(table)}`,
    ).catch(() => [{ n: -1 }]);
    if (Number(r!.n) <= 0) problems.push(`${table}: missing or empty`);
  }
  const [uncited] = await rows<{ n: number }>(
    db,
    sql`select count(*) as n from claim c
        where c.publish_state = 'published' and c.deleted_at is null
          and not exists (select 1 from citation x
            where x.subject_type = 'claim' and x.subject_id = c.id and x.deleted_at is null)`,
  );
  if (Number(uncited!.n) > 0) problems.push(`claim: ${uncited!.n} published without a citation`);
  return problems;
}
