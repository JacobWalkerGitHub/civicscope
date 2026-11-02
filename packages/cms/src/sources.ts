import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import {
  normalizeSourceUrl,
  sourceInputSchema,
  todayIso,
  type SourceRefInput,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { CmsError, mysqlErrorCode, NotFoundError } from './errors';
import { parseInput } from './parse';

const { source, citation } = schema;
export type Source = typeof source.$inferSelect;
export const SOURCE_EDITABLE = [
  'url',
  'title',
  'publisher',
  'sourceType',
  'publishedAt',
  'retrievedAt',
  'archiveUrl',
] as const;

async function load(tx: Tx | Db, id: number): Promise<Source> {
  const [row] = await tx.select().from(source).where(eq(source.id, id));
  if (!row) throw new NotFoundError('Source');
  return row;
}

async function findByUrl(tx: Tx | Db, url: string): Promise<Source | undefined> {
  const [row] = await tx
    .select()
    .from(source)
    .where(eq(source.urlHash, sql`sha2(${url}, 256)`));
  return row;
}

/**
 * Resolves the source a citation points at: an existing source with the same URL is
 * reused; otherwise a new one is created, which needs
 * a title, publisher and type. Field errors use the citation form's "source*" names.
 */
export async function resolveSource(tx: Tx, actor: Actor, ref: SourceRefInput): Promise<Source> {
  const url = normalizeSourceUrl(ref.sourceUrl);
  const existing = await findByUrl(tx, url);
  if (existing) {
    if (existing.deletedAt) {
      throw new CmsError('That source was archived. Restore it on the Sources page to cite it.', {
        sourceUrl: 'This source is archived.',
      });
    }
    return existing;
  }

  const missing: Record<string, string> = {};
  if (!ref.sourceTitle) missing.sourceTitle = 'New source: enter its title.';
  if (!ref.sourcePublisher) missing.sourcePublisher = 'New source: enter who published it.';
  if (!ref.sourceType) missing.sourceType = 'New source: choose its type.';
  if (Object.keys(missing).length) {
    throw new CmsError(
      'This URL is not a known source yet. Fill in its title, publisher and type.',
      missing,
    );
  }
  const [res] = await tx.insert(source).values({
    url,
    title: ref.sourceTitle!,
    publisher: ref.sourcePublisher!,
    sourceType: ref.sourceType!,
    publishedAt: ref.sourcePublishedAt ?? null,
    retrievedAt: todayIso(),
  });
  const created = await load(tx, res.insertId);
  await recordChange(tx, actor, {
    entityType: 'source',
    entityId: created.id,
    action: 'create',
    before: null,
    after: created,
  });
  return created;
}

export async function updateSource(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(sourceInputSchema, input);
  try {
    await db.transaction(async (tx) => {
      const before = await load(tx, id);
      await tx
        .update(source)
        .set({ ...data, url: normalizeSourceUrl(data.url) })
        .where(eq(source.id, id));
      await recordChange(tx, actor, {
        entityType: 'source',
        entityId: id,
        action: opts.action ?? 'update',
        before,
        after: await load(tx, id),
        note: opts.note,
      });
    });
  } catch (error) {
    if (mysqlErrorCode(error) === 'ER_DUP_ENTRY') {
      throw new CmsError('Another source already has that URL.', {
        url: 'Already used by another source.',
      });
    }
    throw error;
  }
}

/** A source can only be archived once nothing live cites it. */
export async function setSourceArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (archived) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(citation)
        .where(and(eq(citation.sourceId, id), isNull(citation.deletedAt)));
      const n = Number(row?.n);
      if (n > 0) {
        throw new CmsError(
          `This source is still cited ${n === 1 ? 'once' : `${n} times`}. Remove those citations first.`,
        );
      }
    }
    await tx
      .update(source)
      .set({ deletedAt: archived ? new Date() : null })
      .where(eq(source.id, id));
    await recordChange(tx, actor, {
      entityType: 'source',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listSources(
  db: Db,
  { query, includeArchived = false }: { query?: string; includeArchived?: boolean } = {},
) {
  const q = query?.trim();
  return db
    .select({
      id: source.id,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      sourceType: source.sourceType,
      retrievedAt: source.retrievedAt,
      deletedAt: source.deletedAt,
      // Spelled out with aliases: Drizzle drops table names from columns in a
      // single-table select, which would make the subquery compare its own columns.
      citationCount: sql<number>`(select count(*) from citation c where c.source_id = ${source}.id and c.deleted_at is null)`,
    })
    .from(source)
    .where(
      and(
        includeArchived ? undefined : isNull(source.deletedAt),
        q
          ? or(
              like(source.title, `%${q}%`),
              like(source.publisher, `%${q}%`),
              like(source.url, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(source.retrievedAt), asc(source.title))
    .limit(200);
}

export const getSource = (db: Db, id: number) => load(db, id);
