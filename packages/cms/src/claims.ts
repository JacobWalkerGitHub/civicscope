import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { can, claimInputSchema, type UserRole } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { diffRows, recordChange, type Actor, type Tx, type UpdateOptions } from './changes';
import { countLiveCitations } from './citations';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';

const { claim, person, issue, adminUser } = schema;
export type Claim = typeof claim.$inferSelect;

/** Content fields: changing any of them means the entry needs review again. */
export const CLAIM_EDITABLE = [
  'contentKind',
  'title',
  'summary',
  'quote',
  'issueId',
  'positionType',
  'bioCategory',
  'organization',
  'statedOn',
  'venue',
  'startYear',
  'endYear',
] as const;

async function load(tx: Tx | Db, id: number): Promise<Claim> {
  const [row] = await tx.select().from(claim).where(eq(claim.id, id));
  if (!row) throw new NotFoundError('Profile entry');
  return row;
}

async function roleOf(tx: Tx | Db, actor: Actor): Promise<UserRole> {
  const [row] = await tx
    .select({ role: adminUser.role })
    .from(adminUser)
    .where(eq(adminUser.id, actor.userId));
  if (!row) throw new CmsError('Your account was not found.');
  return row.role;
}

async function checkReferences(tx: Tx, data: { personId: number; issueId?: number | null }) {
  const [p] = await tx.select().from(person).where(eq(person.id, data.personId));
  if (!p) throw new NotFoundError('Person');
  if (p.deletedAt) throw new CmsError('That person is archived.');
  if (data.issueId) {
    const [i] = await tx.select().from(issue).where(eq(issue.id, data.issueId));
    if (!i || i.deletedAt) {
      throw new CmsError('That issue is archived.', { issueId: 'This issue is archived.' });
    }
  }
  return p;
}

/** Empties the fields that don't apply to the entry's kind. */
function contentValues(data: ReturnType<typeof claimInputSchema.parse>) {
  return {
    contentKind: data.contentKind,
    title: data.title,
    summary: data.summary,
    quote: data.quote ?? null,
    issueId: data.issueId ?? null,
    positionType: data.positionType ?? null,
    bioCategory: data.bioCategory ?? null,
    organization: data.organization ?? null,
    statedOn: data.statedOn ?? null,
    venue: data.venue ?? null,
    startYear: data.startYear ?? null,
    endYear: data.endYear ?? null,
  };
}

export async function createClaim(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(claimInputSchema, input);
  return db.transaction(async (tx) => {
    await checkReferences(tx, data);
    const [res] = await tx.insert(claim).values({
      personId: data.personId,
      kind: data.kind,
      ...contentValues(data),
      lastEditedBy: actor.userId,
    });
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: await load(tx, res.insertId),
    });
    return res.insertId;
  });
}

/**
 * Saves changes to an entry. Any change to its content means it needs review again:
 * - a draft that was approved but not yet published goes back to unverified;
 * - a published entry edited by an editor is taken off the public site and queued
 *   for review, so unreviewed words never appear publicly;
 * - a published entry edited by a reviewer stays published, recorded as verified by them.
 */
export async function updateClaim(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
  opts: UpdateOptions = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this entry before editing.');
    const data = parseInput(claimInputSchema, {
      ...(input as object),
      personId: before.personId,
      kind: before.kind,
    });
    await checkReferences(tx, data);
    const values = contentValues(data);
    if (Object.keys(diffRows(before, { ...before, ...values })).length === 0) return;

    const review: Partial<Claim> = { lastEditedBy: actor.userId };
    let note = opts.note;
    if (before.publishState === 'published') {
      if (can(await roleOf(tx, actor), 'content:publish')) {
        Object.assign(review, {
          verificationStatus: 'verified',
          verifiedBy: actor.userId,
          verifiedAt: new Date(),
        });
        note ??= 'Edited and re-verified by a reviewer';
      } else {
        Object.assign(review, {
          publishState: 'unpublished',
          verificationStatus: 'pending_review',
          submittedAt: new Date(),
          reviewNote: null,
        });
        note ??= 'Edited after publishing: taken down until a reviewer approves it';
      }
    } else if (before.verificationStatus === 'verified') {
      review.verificationStatus = 'unverified';
    }

    await tx
      .update(claim)
      .set({ ...values, ...review })
      .where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: opts.action ?? 'update',
      before,
      after: await load(tx, id),
      note,
    });
  });
}

/** Sends an entry to the review queue. It must already cite at least one source. */
export async function submitClaimForReview(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this entry first.');
    if (before.verificationStatus === 'pending_review') return;
    if (before.publishState === 'published') throw new CmsError('This entry is already published.');
    if ((await countLiveCitations(tx, 'claim', id)) === 0) {
      throw new CmsError('Add at least one source before sending this for review.');
    }
    await tx
      .update(claim)
      .set({ verificationStatus: 'pending_review', submittedAt: new Date(), reviewNote: null })
      .where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: 'update',
      before,
      after: await load(tx, id),
      note: 'Sent for review',
    });
  });
}

/**
 * A reviewer approves an entry in the review queue, which verifies and publishes it.
 * Reviewers can't approve entries they last edited themselves; a second person has to.
 * Owners may, since a one-person team would otherwise be stuck, and the audit log
 * records that they did.
 */
export async function approveClaim(
  db: Db,
  actor: Actor,
  id: number,
  note?: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    const role = await roleOf(tx, actor);
    if (!can(role, 'content:publish')) throw new CmsError('Only reviewers can approve entries.');
    if (before.verificationStatus !== 'pending_review') {
      throw new CmsError('This entry is not waiting for review.');
    }
    const selfApproved = before.lastEditedBy === actor.userId;
    if (selfApproved && role !== 'owner') {
      throw new CmsError('You made the latest changes, so another reviewer needs to approve them.');
    }
    if ((await countLiveCitations(tx, 'claim', id)) === 0) {
      throw new CmsError('This entry has no sources, so it can’t be approved.');
    }
    const [p] = await tx.select().from(person).where(eq(person.id, before.personId));
    if (p?.publishState !== 'published') {
      throw new CmsError(
        'Publish the person first; their profile entries can’t appear without them.',
      );
    }
    await tx
      .update(claim)
      .set({
        verificationStatus: 'verified',
        verifiedBy: actor.userId,
        verifiedAt: new Date(),
        publishState: 'published',
        reviewNote: note?.trim() || null,
      })
      .where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: 'publish',
      before,
      after: await load(tx, id),
      note: selfApproved ? 'Approved by the owner who wrote it' : 'Approved in review',
    });
  });
}

/** Returns an entry to its author with a note saying what to fix. */
export async function sendClaimBack(db: Db, actor: Actor, id: number, note: string): Promise<void> {
  const reason = note?.trim();
  if (!reason) throw new CmsError('Say what needs to change.', { note: 'Enter a note.' });
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.verificationStatus !== 'pending_review') {
      throw new CmsError('This entry is not waiting for review.');
    }
    await tx
      .update(claim)
      .set({ verificationStatus: 'unverified', reviewNote: reason.slice(0, 1000) })
      .where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: 'update',
      before,
      after: await load(tx, id),
      note: `Sent back: ${reason.slice(0, 900)}`,
    });
  });
}

/** Takes a published entry off the public site. It keeps its verification. */
export async function unpublishClaim(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.publishState !== 'published') return;
    await tx.update(claim).set({ publishState: 'unpublished' }).where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: 'unpublish',
      before,
      after: await load(tx, id),
    });
  });
}

/** Puts a verified, unpublished entry back on the public site without another review. */
export async function republishClaim(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (before.deletedAt) throw new CmsError('Restore this entry first.');
    if (before.verificationStatus !== 'verified') {
      throw new CmsError('Only verified entries can be published. Send it for review.');
    }
    if ((await countLiveCitations(tx, 'claim', id)) === 0) {
      throw new CmsError('Add at least one source before publishing.');
    }
    const [p] = await tx.select().from(person).where(eq(person.id, before.personId));
    if (p?.publishState !== 'published') throw new CmsError('Publish the person first.');
    if (before.publishState === 'published') return;
    await tx.update(claim).set({ publishState: 'published' }).where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: 'publish',
      before,
      after: await load(tx, id),
    });
  });
}

export async function setClaimArchived(
  db: Db,
  actor: Actor,
  id: number,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    if (!archived) await checkReferences(tx, before);
    await tx
      .update(claim)
      .set({
        deletedAt: archived ? new Date() : null,
        publishState: archived ? 'archived' : 'draft',
        // A restored entry starts over: it is checked again before going public.
        verificationStatus: 'unverified',
      })
      .where(eq(claim.id, id));
    await recordChange(tx, actor, {
      entityType: 'claim',
      entityId: id,
      action: archived ? 'archive' : 'restore',
      before,
      after: await load(tx, id),
    });
  });
}

export async function listClaimsForPerson(db: Db, personId: number) {
  return db
    .select({
      id: claim.id,
      kind: claim.kind,
      title: claim.title,
      contentKind: claim.contentKind,
      verificationStatus: claim.verificationStatus,
      publishState: claim.publishState,
      deletedAt: claim.deletedAt,
      issueName: issue.name,
      statedOn: claim.statedOn,
      startYear: claim.startYear,
    })
    .from(claim)
    .leftJoin(issue, eq(claim.issueId, issue.id))
    .where(eq(claim.personId, personId))
    .orderBy(asc(claim.kind), asc(issue.name), desc(claim.startYear), asc(claim.title));
}

/** Entries waiting for a reviewer, oldest first. */
export async function listReviewQueue(db: Db) {
  return db
    .select({
      id: claim.id,
      kind: claim.kind,
      title: claim.title,
      submittedAt: claim.submittedAt,
      lastEditedBy: claim.lastEditedBy,
      editorName: adminUser.name,
      personId: person.id,
      personName: person.fullName,
      issueName: issue.name,
      wasPublished: sql<boolean>`${claim.publishState} = 'unpublished'`,
    })
    .from(claim)
    .innerJoin(person, eq(claim.personId, person.id))
    .leftJoin(issue, eq(claim.issueId, issue.id))
    .leftJoin(adminUser, eq(adminUser.id, claim.lastEditedBy))
    .where(and(eq(claim.verificationStatus, 'pending_review'), isNull(claim.deletedAt)))
    .orderBy(asc(claim.submittedAt));
}

export async function countReviewQueue(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(claim)
    .where(and(eq(claim.verificationStatus, 'pending_review'), isNull(claim.deletedAt)));
  return Number(row?.n ?? 0);
}

/** An entry plus the names needed to show it in context. */
export async function getClaim(db: Db, id: number) {
  const row = await load(db, id);
  const [p] = await db
    .select({ fullName: person.fullName, publishState: person.publishState })
    .from(person)
    .where(eq(person.id, row.personId));
  const names = await db
    .select({ id: adminUser.id, name: adminUser.name })
    .from(adminUser)
    .where(sql`${adminUser.id} in (${row.lastEditedBy ?? 0}, ${row.verifiedBy ?? 0})`);
  const nameOf = (uid: number | null) => names.find((n) => n.id === uid)?.name ?? null;
  return {
    ...row,
    personName: p!.fullName,
    personPublishState: p!.publishState,
    lastEditedByName: nameOf(row.lastEditedBy),
    verifiedByName: nameOf(row.verifiedBy),
  };
}
