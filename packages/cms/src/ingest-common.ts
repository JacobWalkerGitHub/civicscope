import { eq, sql } from 'drizzle-orm';
import { normalizeSourceUrl } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';

const { adminUser, source } = schema;

/*
 * Pieces every automated connector shares: the disabled account it acts as, and
 * fetching with retries.
 */

export interface SystemAccount {
  /** Short key used in the audit log, e.g. "fec-import". */
  key: string;
  email: string;
  name: string;
}

export const FEC_ACCOUNT: SystemAccount = {
  key: 'fec-import',
  email: 'fec-import@system.civicscope.invalid',
  name: 'Automated import (FEC)',
};
export const CONGRESS_ACCOUNT: SystemAccount = {
  key: 'congress-import',
  email: 'congress-import@system.civicscope.invalid',
  name: 'Automated import (Congress)',
};

/** The admin account an automated import acts as. It can never sign in. */
export async function systemActor(db: Db, account: SystemAccount = FEC_ACCOUNT): Promise<Actor> {
  const [found] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.email, account.email));
  if (found) return { userId: found.id, ipAddress: null };
  const [res] = await db.insert(adminUser).values({
    email: account.email,
    name: account.name,
    // Not a valid hash of anything, and the account is disabled, so no one can sign in as it.
    passwordHash: '!',
    role: 'editor',
    disabledAt: new Date(),
  });
  await recordAudit(db, {
    actorType: 'system',
    actorId: account.key,
    action: 'create',
    entityType: 'admin_user',
    entityId: String(res.insertId),
    diff: { email: [null, account.email] },
    note: `Account for ${account.name.toLowerCase()} runs (disabled; cannot sign in)`,
    ipAddress: null,
  });
  return { userId: res.insertId, ipAddress: null };
}

export interface FetchOptions {
  fetch?: typeof fetch;
  /** Waits between retries and requests; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** The URL without its API key, safe to store and show. */
export const withoutKey = (url: URL | string) => {
  const copy = new URL(url);
  copy.searchParams.delete('api_key');
  return copy.toString();
};

/**
 * GETs a URL, retrying rate limits, server errors and network failures with backoff.
 * Six tries over about four minutes: imports run unattended for hours, and Congress.gov
 * has been seen to hang on one URL for a few minutes and then recover.
 */
export async function fetchText(url: URL, opts: FetchOptions): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (res.ok) return res.text();
    lastError = `HTTP ${res.status}`;
    // Rate limits and server errors are worth retrying; anything else is not.
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`Could not fetch ${withoutKey(url)}: ${lastError}`);
}

/** Today's date (YYYY-MM-DD) in UTC. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Finds or creates the source row for a document an import cites. Created sources are
 * recorded in the history; an existing one just gets today as its "last checked" date.
 */
export async function ensureImportSource(
  tx: Tx,
  actor: Actor,
  ref: {
    url: string;
    title: string;
    publisher: string;
    sourceType: typeof source.$inferInsert.sourceType;
  },
  today: string,
): Promise<number> {
  const url = normalizeSourceUrl(ref.url);
  const [existing] = await tx
    .select()
    .from(source)
    .where(eq(source.urlHash, sql`sha2(${url}, 256)`));
  if (existing) {
    if (existing.retrievedAt !== today) {
      await tx.update(source).set({ retrievedAt: today }).where(eq(source.id, existing.id));
    }
    return existing.id;
  }
  const [res] = await tx.insert(source).values({
    url,
    title: ref.title.slice(0, 500),
    publisher: ref.publisher,
    sourceType: ref.sourceType,
    retrievedAt: today,
  });
  const [created] = await tx.select().from(source).where(eq(source.id, res.insertId));
  await recordChange(tx, actor, {
    entityType: 'source',
    entityId: res.insertId,
    action: 'create',
    before: null,
    after: created!,
    note: 'Created by an automated import',
  });
  return res.insertId;
}
