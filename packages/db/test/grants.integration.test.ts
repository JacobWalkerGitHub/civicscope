import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAppGrants, createDb, createPool, schema, type Db } from '../src/index';
import { startTestDatabase, type TestDatabase } from '../src/testing';

let test: TestDatabase;
let root: Db;
let rootPool: ReturnType<typeof createPool>;
let app: Db;
let appPool: ReturnType<typeof createPool>;

function errorCode(error: unknown): string | undefined {
  let e: unknown = error;
  while (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ER_')) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectDenied(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(errorCode(error)).toMatch(/^ER_(TABLEACCESS|DBACCESS|SPECIFIC_ACCESS)_DENIED_ERROR$/);
}

beforeAll(async () => {
  test = await startTestDatabase();
  rootPool = createPool(test.container.getConnectionUri(true));
  root = createDb(rootPool);
  await applyAppGrants(root, { user: 'civicscope_app', password: 'app-password-1' });
  const url = new URL(test.url);
  url.username = 'civicscope_app';
  url.password = 'app-password-1';
  appPool = createPool(url.toString());
  app = createDb(appPool);
});
afterAll(async () => {
  await appPool?.end();
  await rootPool?.end();
  await test?.stop();
});

describe('app database account', () => {
  it('reads and writes content tables', async () => {
    await app.insert(schema.issue).values({ slug: 'grants-test', name: 'Grants test' });
    await app.execute(sql`update issue set name = 'Grants test 2' where slug = 'grants-test'`);
    await app.execute(sql`delete from issue where slug = 'grants-test'`);
  });

  it('can add to the history tables but never change or delete them', async () => {
    await app.insert(schema.auditLog).values({
      actorType: 'system',
      actorId: 'grants-test',
      action: 'create',
      entityType: 'test',
      entityId: '1',
    });
    const [rows] = (await app.execute(sql`select count(*) as n from audit_log`)) as unknown as [
      { n: number }[],
    ];
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    await expectDenied(app.execute(sql`update audit_log set note = 'rewritten'`));
    await expectDenied(app.execute(sql`delete from audit_log`));
    await expectDenied(app.execute(sql`update revision set note = 'x'`));
    await expectDenied(app.execute(sql`delete from revision`));
    await expectDenied(app.execute(sql`delete from candidacy_status_event`));
  });

  it('cannot change the schema, drop triggers or read the migrations table', async () => {
    await expectDenied(app.execute(sql`create table sneaky (id int)`));
    await expectDenied(app.execute(sql`drop trigger audit_log_no_update`));
    await expectDenied(app.execute(sql`alter table audit_log add column x int`));
    await expectDenied(app.execute(sql`select * from __drizzle_migrations`));
  });

  it('is idempotent and rotates the password', async () => {
    await applyAppGrants(root, { user: 'civicscope_app', password: 'app-password-2' });
    const url = new URL(test.url);
    url.username = 'civicscope_app';
    url.password = 'app-password-2';
    const pool = createPool(url.toString());
    try {
      await createDb(pool).execute(sql`select 1`);
    } finally {
      await pool.end();
    }
  });

  it('rejects unsafe account names', async () => {
    await expect(applyAppGrants(root, { user: "x'; drop table person; --" })).rejects.toThrow(
      /letters, digits/,
    );
  });
});
