import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { citationInputSchema, type CitationSubject } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';
import { resolveSource } from './sources';

const { citation, source, person, candidacy } = schema;
export type Citation = typeof citation.$inferSelect;

async function load(tx: Tx | Db, id: number): Promise<Citation> {
  const [row] = await tx.select().from(citation).where(eq(citation.id, id));
  if (!row) throw new NotFoundError('Citation');
  return row;
}

/** The record a citation points at must exist and not be archived. */
async function loadSubject(tx: Tx | Db, type: CitationSubject, id: number) {
  const table = type === 'person' ? person : candidacy;
  const [row] = await tx
    .select({ publishState: table.publishState, deletedAt: table.deletedAt })
    .from(table)
    .where(eq(table.id, id));
  if (!row) throw new NotFoundError(type === 'person' ? 'Person' : 'Candidacy');
  return row;
}

export async function countLiveCitations(
  tx: Tx | Db,
  subjectType: CitationSubject,
  subjectId: number,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(citation)
    .where(
      and(
        eq(citation.subjectType, subjectType),
        eq(citation.subjectId, subjectId),
        isNull(citation.deletedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Inserts a citation inside an existing transaction. */
export async function insertCitation(
  tx: Tx,
  actor: Actor,
  values: Omit<typeof citation.$inferInsert, 'id' | 'createdAt' | 'deletedAt'>,
): Promise<number> {
  const [res] = await tx.insert(citation).values(values);
  await recordChange(tx, actor, {
    entityType: 'citation',
    entityId: res.insertId,
    action: 'create',
    before: null,
    after: await load(tx, res.insertId),
  });
  return res.insertId;
}

export async function addCitation(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(citationInputSchema, input);
  return db.transaction(async (tx) => {
    const subject = await loadSubject(tx, data.subjectType, data.subjectId);
    if (subject.deletedAt) throw new CmsError('Restore this record before adding sources.');
    const src = await resolveSource(tx, actor, data);
    return insertCitation(tx, actor, {
      sourceId: src.id,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      field: data.field ?? null,
      excerpt: data.excerpt ?? null,
      locator: data.locator ?? null,
    });
  });
}

/**
 * Removes (archives) a citation. A published record must keep at least one source,
 * so the last citation of a published record can't be removed.
 */
export async function removeCitation(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) return;
    const subject = await loadSubject(tx, before.subjectType, before.subjectId);
    if (
      subject.publishState === 'published' &&
      (await countLiveCitations(tx, before.subjectType, before.subjectId)) <= 1
    ) {
      throw new CmsError(
        'This is the only source for a published record. Add another source or unpublish it first.',
      );
    }
    await tx.update(citation).set({ deletedAt: new Date() }).where(eq(citation.id, id));
    await recordChange(tx, actor, {
      entityType: 'citation',
      entityId: id,
      action: 'archive',
      before,
      after: await load(tx, id),
    });
  });
}

/** Live citations of one record, with their sources. */
export async function listCitations(db: Db, subjectType: CitationSubject, subjectId: number) {
  return db
    .select({
      id: citation.id,
      field: citation.field,
      excerpt: citation.excerpt,
      locator: citation.locator,
      createdAt: citation.createdAt,
      sourceId: source.id,
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourcePublisher: source.publisher,
      sourceType: source.sourceType,
      retrievedAt: source.retrievedAt,
    })
    .from(citation)
    .innerJoin(source, eq(citation.sourceId, source.id))
    .where(
      and(
        eq(citation.subjectType, subjectType),
        eq(citation.subjectId, subjectId),
        isNull(citation.deletedAt),
      ),
    )
    .orderBy(asc(citation.id));
}

/** What a source is cited for, for the source's own page. */
export async function listCitationsOfSource(db: Db, sourceId: number) {
  return db
    .select({
      id: citation.id,
      subjectType: citation.subjectType,
      subjectId: citation.subjectId,
      field: citation.field,
      excerpt: citation.excerpt,
      personName: person.fullName,
      candidacyName: candidacy.ballotName,
    })
    .from(citation)
    .leftJoin(person, and(eq(citation.subjectType, 'person'), eq(citation.subjectId, person.id)))
    .leftJoin(
      candidacy,
      and(eq(citation.subjectType, 'candidacy'), eq(citation.subjectId, candidacy.id)),
    )
    .where(and(eq(citation.sourceId, sourceId), isNull(citation.deletedAt)))
    .orderBy(asc(citation.id));
}
