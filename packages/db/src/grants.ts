import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * History tables the app may add to but never change. Triggers already reject
 * UPDATE and DELETE on them; withholding the privileges is a second, independent
 * guard that holds even if a trigger were dropped.
 */
export const APPEND_ONLY_TABLES = ['audit_log', 'revision', 'candidacy_status_event'] as const;

/** Bookkeeping that only the migration user touches. */
const MIGRATION_ONLY_TABLES = ['__drizzle_migrations'];

const IDENT = /^[A-Za-z0-9_]{1,32}$/;
const HOST = /^[A-Za-z0-9_.%:-]{1,255}$/;

export interface AppUserOptions {
  /** MySQL account the web app connects as. */
  user: string;
  /** Host part of the account; '%' allows any host (use the VPC range in production). */
  host?: string;
  /** Sets or rotates the password. Leave out to keep the current one. */
  password?: string;
}

/**
 * Creates (or updates) the least-privilege account the web app uses: read and write
 * on content tables, insert-only on history tables, no schema changes and no access
 * to the migrations table. Run as the migration user after every migration, so new
 * tables are covered; it rebuilds the account's grants from scratch each time.
 */
export async function applyAppGrants(db: Db, opts: AppUserOptions): Promise<string[]> {
  const host = opts.host ?? '%';
  if (!IDENT.test(opts.user)) throw new Error('App database user: letters, digits and _ only.');
  if (!HOST.test(host)) throw new Error('App database host is not valid.');
  const account = sql.raw(`'${opts.user}'@'${host}'`);

  const [[{ schema }]] = (await db.execute(sql`select database() as \`schema\``)) as unknown as [
    [{ schema: string | null }],
  ];
  if (!schema) throw new Error('Connect to the CivicScope database before applying grants.');
  if (!IDENT.test(schema)) throw new Error('Unexpected database name.');

  if (opts.password) {
    await db.execute(sql`create user if not exists ${account} identified by ${opts.password}`);
    await db.execute(sql`alter user ${account} identified by ${opts.password}`);
  } else {
    await db.execute(sql`create user if not exists ${account}`);
  }
  await db.execute(sql`revoke all privileges, grant option from ${account}`);

  const [rows] = (await db.execute(
    sql`select table_name as name from information_schema.tables
        where table_schema = ${schema} and table_type = 'BASE TABLE' order by table_name`,
  )) as unknown as [{ name: string }[]];
  const granted: string[] = [];
  for (const { name } of rows) {
    if (MIGRATION_ONLY_TABLES.includes(name)) continue;
    if (!IDENT.test(name)) throw new Error(`Unexpected table name: ${name}`);
    const appendOnly = (APPEND_ONLY_TABLES as readonly string[]).includes(name);
    const privileges = appendOnly ? 'select, insert' : 'select, insert, update, delete';
    await db.execute(
      sql.raw(`grant ${privileges} on \`${schema}\`.\`${name}\` to '${opts.user}'@'${host}'`),
    );
    granted.push(`${name}: ${privileges}`);
  }
  return granted;
}
