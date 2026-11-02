import { and, desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import type { Actor } from './changes';
import { CmsError, NotFoundError } from './errors';
import { ELECTION_EDITABLE, RACE_EDITABLE, updateElection, updateRace } from './elections';
import { OFFICE_EDITABLE, updateOffice } from './offices';
import { PARTY_EDITABLE, updateParty } from './parties';

/** Entities whose versions can be restored, with their editable fields and updater. */
const RESTORABLE = {
  party: { fields: PARTY_EDITABLE, update: updateParty },
  office: { fields: OFFICE_EDITABLE, update: updateOffice },
  election: { fields: ELECTION_EDITABLE, update: updateElection },
  race: { fields: RACE_EDITABLE, update: updateRace },
} as const;
export type RestorableEntity = keyof typeof RESTORABLE;

export function isRestorable(entityType: string): entityType is RestorableEntity {
  return entityType in RESTORABLE;
}

/** Every saved version of a record, newest first, with who saved it. */
export async function listRevisions(db: Db, entityType: string, entityId: number) {
  const { revision, adminUser } = schema;
  return db
    .select({
      version: revision.version,
      createdAt: revision.createdAt,
      note: revision.note,
      snapshot: revision.snapshot,
      authorId: revision.authorId,
      authorName: adminUser.name,
    })
    .from(revision)
    .leftJoin(adminUser, eq(adminUser.id, revision.authorId))
    .where(and(eq(revision.entityType, entityType), eq(revision.entityId, String(entityId))))
    .orderBy(desc(revision.version));
}

/** The audit trail for one record, newest first. */
export async function listAuditEntries(db: Db, entityType: string, entityId: number) {
  const { auditLog, adminUser } = schema;
  return db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      diff: auditLog.diff,
      note: auditLog.note,
      actorName: adminUser.name,
      actorId: auditLog.actorId,
    })
    .from(auditLog)
    .leftJoin(adminUser, eq(adminUser.id, auditLog.actorId))
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, String(entityId))))
    .orderBy(desc(auditLog.id));
}

/**
 * Restores the editable fields of an earlier version. The restore is validated like
 * any edit and saved as a new version, so nothing in the history is lost.
 * Publish and archive state are not restored; those are separate decisions.
 */
export async function restoreRevision(
  db: Db,
  actor: Actor,
  entityType: RestorableEntity,
  entityId: number,
  version: number,
): Promise<void> {
  const { revision } = schema;
  const [row] = await db
    .select()
    .from(revision)
    .where(
      and(
        eq(revision.entityType, entityType),
        eq(revision.entityId, String(entityId)),
        eq(revision.version, version),
      ),
    );
  if (!row) throw new NotFoundError(`Version ${version}`);

  const config = RESTORABLE[entityType];
  const snapshot = row.snapshot as Record<string, unknown>;
  const input: Record<string, unknown> = {};
  for (const field of config.fields) input[field] = snapshot[field];
  if (input.isPartisan !== undefined) input.isPartisan = Boolean(input.isPartisan);
  if (input.isSpecial !== undefined) input.isSpecial = Boolean(input.isSpecial);
  try {
    await config.update(db, actor, entityId, input, {
      action: 'restore',
      note: `Restored version ${version}`,
    });
  } catch (error) {
    if (error instanceof CmsError) {
      throw new CmsError(`Version ${version} can't be restored as it is: ${error.message}`);
    }
    throw error;
  }
}
