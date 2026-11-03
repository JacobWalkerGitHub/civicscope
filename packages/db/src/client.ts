import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index';

export function createPool(url: string) {
  return mysql.createPool({ uri: url, connectionLimit: 10, timezone: 'Z', dateStrings: false });
}

export function createDb(pool: mysql.Pool) {
  return drizzle(pool, { schema, mode: 'default' });
}

export type Db = ReturnType<typeof createDb>;

/**
 * The database address from the environment: DATABASE_URL, or else DB_HOST, DB_PORT,
 * DB_NAME, DB_USER and DB_PASSWORD separately (how ECS passes a Secrets Manager
 * secret's fields). DB_TLS=true requires a verified TLS connection, which RDS needs
 * when require_secure_transport is on; the container trusts the RDS certificate
 * authorities through NODE_EXTRA_CA_CERTS.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_TLS } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return null;
  const url = new URL(`mysql://${DB_HOST}:${DB_PORT || '3306'}/${encodeURIComponent(DB_NAME)}`);
  url.username = encodeURIComponent(DB_USER);
  url.password = encodeURIComponent(DB_PASSWORD);
  if (DB_TLS === 'true') url.searchParams.set('ssl', '{"rejectUnauthorized":true}');
  return url.toString();
}
