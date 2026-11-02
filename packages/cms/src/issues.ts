import { asc, eq, isNull, sql } from 'drizzle-orm';
import { issueInputSchema } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';
import { uniqueSlug } from './slugs';

const { issue, claim } = schema;
export type Issue = typeof issue.$inferSelect;
export const ISSUE_EDITABLE = ['name', 'description'] as const;

async function load(tx: Tx | Db, id: number): Promise<Issue> {
  const [row] = await tx.select().from(issue).where(eq(issue.id, id));
  if (!row) throw new NotFoundError('Issue');
  return row;
}

export async function createIssue(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(issueInputSchema, input);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select().from(issue).where(eq(issue.name, data.name));
    if (dup)
      throw new CmsError('An issue with that name already exists.', { name: 'Already exists.' });
    const slug = await uniqueSlug(tx, issue, issue.slug, data.name);
    const [res] = await tx.insert(issue).values({ ...data, slug });
    await recordChange(tx, actor, {
      entityType: 'issue',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await load(tx, res.insertId),
    });
    return res.insertId;
  });
}

/** Renaming keeps the slug, so links to the issue keep working. */
export async function updateIssue(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  const data = parseInput(issueInputSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    await tx.update(issue).set(data).where(eq(issue.id, id));
    await recordChange(tx, actor, {
      entityType: 'issue',
      entityId: id,
      action: opts.action ?? 'update',
      before,
      after: await load(tx, id),
      note: opts.note,
    });
  });
}

export async function setIssueArchived(
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
        .from(claim)
        .where(sql`${claim.issueId} = ${id} and ${claim.deletedAt} is null`);
      const n = Number(row?.n);
      if (n > 0) {
        throw new CmsError(
          `${n} position${n === 1 ? ' is' : 's are'} filed under this issue. Move or archive them first.`,
        );
      }
    }
    await tx
      .update(issue)
      .set({ deletedAt: archived ? new Date() : null })
      .where(eq(issue.id, id));
    await recordChange(tx, actor, {
      entityType: 'issue',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listIssues(db: Db, { includeArchived = false } = {}) {
  return db
    .select({
      id: issue.id,
      name: issue.name,
      description: issue.description,
      deletedAt: issue.deletedAt,
      // Aliased on purpose; see listSources.
      positionCount: sql<number>`(select count(*) from claim c where c.issue_id = ${issue}.id and c.deleted_at is null)`,
    })
    .from(issue)
    .where(includeArchived ? undefined : isNull(issue.deletedAt))
    .orderBy(asc(issue.name));
}

export const getIssue = (db: Db, id: number) => load(db, id);
