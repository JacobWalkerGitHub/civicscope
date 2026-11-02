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
