import { and, asc, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import {
  correctionRequestSchema,
  correctionResolutionSchema,
  coverageInputSchema,
  type CorrectionState,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';

const { correctionRequest, coverageStatus, jurisdiction } = schema;
export type CorrectionRequest = typeof correctionRequest.$inferSelect;

/** Requests one address may send per hour, and all addresses together. */
export const CORRECTION_LIMITS = { perAddressPerHour: 5, totalPerHour: 300 } as const;

const RESOLVED: readonly CorrectionState[] = ['fixed', 'no_change', 'spam'];

/**
 * Stores a reader's correction request. Anyone may send one, so the input is
 * validated, size-limited and rate-limited here rather than trusted.
 */
export async function submitCorrectionRequest(
  db: Db,
  input: unknown,
  { ipAddress }: { ipAddress: string | null },
): Promise<number> {
  const data = parseInput(correctionRequestSchema, input);
  const hourAgo = sql`CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR`;
  const [total] = await db
    .select({ n: count() })
    .from(correctionRequest)
    .where(gte(correctionRequest.submittedAt, hourAgo));
  const [mine] = ipAddress
    ? await db
        .select({ n: count() })
        .from(correctionRequest)
        .where(
          and(
            eq(correctionRequest.ipAddress, ipAddress),
            gte(correctionRequest.submittedAt, hourAgo),
          ),
        )
    : [{ n: 0 }];
  if (
    (total?.n ?? 0) >= CORRECTION_LIMITS.totalPerHour ||
    (mine?.n ?? 0) >= CORRECTION_LIMITS.perAddressPerHour
  ) {
    throw new CmsError('We’ve had a lot of requests in the last hour. Please try again later.');
  }
  const [res] = await db.insert(correctionRequest).values({ ...data, ipAddress });
  return res.insertId;
}

export async function listCorrectionRequests(
  db: Db,
  { open }: { open: boolean },
): Promise<CorrectionRequest[]> {
  return db
    .select()
    .from(correctionRequest)
    .where(
      open
        ? sql`${correctionRequest.state} in ('new', 'in_review')`
        : sql`${correctionRequest.state} not in ('new', 'in_review')`,
    )
    .orderBy(open ? asc(correctionRequest.submittedAt) : desc(correctionRequest.resolvedAt))
    .limit(200);
}

export async function countOpenCorrections(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(correctionRequest)
    .where(eq(correctionRequest.state, 'new'));
  return row?.n ?? 0;
}

async function load(tx: Tx | Db, id: number): Promise<CorrectionRequest> {
  const [row] = await tx.select().from(correctionRequest).where(eq(correctionRequest.id, id));
  if (!row) throw new NotFoundError('Correction request');
  return row;
}

export const getCorrectionRequest = (db: Db, id: number) => load(db, id);

/** The audit trail keeps what was decided, not the reader's email or address. */
function forHistory(row: CorrectionRequest) {
  return { ...row, contactEmail: null, ipAddress: null };
}

/** Records an editor's decision. A public note puts the fix in the corrections log. */
export async function resolveCorrectionRequest(
  db: Db,
  actor: Actor,
  id: number,
  input: unknown,
): Promise<void> {
  const data = parseInput(correctionResolutionSchema, input);
  await db.transaction(async (tx) => {
    const before = await load(tx, id);
    const resolved = RESOLVED.includes(data.state);
    await tx
      .update(correctionRequest)
      .set({
        state: data.state,
        internalNote: data.internalNote ?? null,
        publicNote: data.publicNote ?? null,
        resolvedBy: resolved ? actor.userId : null,
        resolvedAt: resolved ? (before.resolvedAt ?? new Date()) : null,
      })
      .where(eq(correctionRequest.id, id));
    await recordChange(tx, actor, {
      entityType: 'correction_request',
      entityId: id,
      action: 'update',
      before: forHistory(before),
      after: forHistory(await load(tx, id)),
    });
  });
}

/** Fixed requests with a public note, newest first. */
export async function listPublicCorrections(db: Db, limit = 100) {
  return db
    .select({
      id: correctionRequest.id,
      resolvedAt: correctionRequest.resolvedAt,
      publicNote: correctionRequest.publicNote,
      pagePath: correctionRequest.pagePath,
    })
    .from(correctionRequest)
    .where(and(eq(correctionRequest.state, 'fixed'), isNotNull(correctionRequest.publicNote)))
    .orderBy(desc(correctionRequest.resolvedAt))
    .limit(limit);
}

export async function listCoverage(db: Db) {
  return db
    .select({
      id: coverageStatus.id,
      jurisdictionId: coverageStatus.jurisdictionId,
      jurisdictionName: jurisdiction.name,
      cycleYear: coverageStatus.cycleYear,
      officeLevel: coverageStatus.officeLevel,
      level: coverageStatus.level,
      asOf: coverageStatus.asOf,
      note: coverageStatus.note,
    })
    .from(coverageStatus)
    .innerJoin(jurisdiction, eq(jurisdiction.id, coverageStatus.jurisdictionId))
    .orderBy(
      desc(coverageStatus.cycleYear),
      asc(jurisdiction.name),
      asc(coverageStatus.officeLevel),
    );
}

/** Sets the coverage for one state, cycle and office level, replacing what was there. */
export async function setCoverage(db: Db, actor: Actor, input: unknown): Promise<number> {
  const data = parseInput(coverageInputSchema, input);
  const values = { ...data, asOf: data.asOf ?? null, note: data.note ?? null };
  return db.transaction(async (tx) => {
    const where = and(
      eq(coverageStatus.jurisdictionId, data.jurisdictionId),
      eq(coverageStatus.cycleYear, data.cycleYear),
      eq(coverageStatus.officeLevel, data.officeLevel),
    );
    const [before] = await tx.select().from(coverageStatus).where(where).for('update');
    let id: number;
    if (before) {
      id = before.id;
      await tx.update(coverageStatus).set(values).where(eq(coverageStatus.id, id));
    } else {
      const [res] = await tx.insert(coverageStatus).values(values);
      id = res.insertId;
    }
    const [after] = await tx.select().from(coverageStatus).where(eq(coverageStatus.id, id));
    await recordChange(tx, actor, {
      entityType: 'coverage_status',
      entityId: id,
      action: before ? 'update' : 'create',
      before: before ?? null,
      after: after!,
    });
    return id;
  });
}

export async function removeCoverage(db: Db, actor: Actor, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(coverageStatus).where(eq(coverageStatus.id, id));
    if (!before) throw new NotFoundError('Coverage row');
    await tx.delete(coverageStatus).where(eq(coverageStatus.id, id));
    await recordChange(tx, actor, {
      entityType: 'coverage_status',
      entityId: id,
      action: 'delete',
      before,
      after: { ...before, deleted: true },
    });
  });
}
