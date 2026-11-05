import { and, asc, desc, eq, inArray, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PersonIdentifierScheme, PublishState, StateOfficeRole } from '@civicscope/core';
import { recordAudit, schema, type Db } from '@civicscope/db';
import { listCurrentMembers } from './bills';
import { recordChange, type Actor, type Tx } from './changes';
import { CmsError, NotFoundError } from './errors';
import { listStateOfficials } from './state-officials';

const {
  candidacy,
  citation,
  claim,
  election,
  fieldLock,
  person,
  personIdentifier,
  personPhoto,
  race,
  reviewItem,
} = schema;

/*
 * Joining up duplicate people. The usual case: an editor entered a candidate by hand,
 * and a Congress or Open States import later created the same person (with the
 * officeholder ID that votes and bills hang off). Merging moves everything onto one
 * record and archives the other, so nothing is deleted: every moved row gets its own
 * audit entry and revision, the archived record remembers where it went
 * (merged_into_id), and its old public address redirects.
 *
 * Linking is the simpler case: the officeholder has no CivicScope person yet, so the
 * candidate just takes their ID.
 */

/** Someone a candidate could be joined up with. */
export interface LinkTarget {
  kind: 'congress' | 'state' | 'person';
  /** For 'congress' and 'state': the officeholder ID the person would take. */
  scheme: PersonIdentifierScheme | null;
  value: string | null;
  name: string;
  /** "U.S. Senate, Kentucky" style, or the number of candidacies for a plain person. */
  detail: string;
  /** The CivicScope person who already carries the ID, if any. */
  linkedPerson: { id: number; fullName: string; publishState: PublishState } | null;
}

const SEARCH_LIMIT = 25;

const ROLE_NAMES: Record<StateOfficeRole, string> = {
  governor: 'Governor',
  upper: 'State Senate',
  lower: 'State House',
  legislature: 'Legislature',
};

/** Officeholders and people matching a name, for the "join up" search on a person's page. */
export async function findLinkTargets(
  db: Db,
  personId: number,
  query: string,
): Promise<LinkTarget[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const [members, officials] = await Promise.all([
    listCurrentMembers(db, { q }),
    listStateOfficials(db, { q }),
  ]);
  const ids = [
    ...members.rows.map((m) => ({ scheme: 'bioguide' as const, value: m.bioguideId })),
    ...officials.rows.map((o) => ({ scheme: 'openstates' as const, value: o.osPersonId })),
  ];
  const owners = await identifierOwners(db, ids);
  const out: LinkTarget[] = [];
  for (const m of members.rows.slice(0, SEARCH_LIMIT)) {
    out.push({
      kind: 'congress',
      scheme: 'bioguide',
      value: m.bioguideId,
      name: m.memberName ?? m.bioguideId,
      detail: `${m.chamber === 'senate' ? 'U.S. Senate' : 'U.S. House'}, ${m.state}${
        m.chamber === 'house' && m.district != null
          ? m.district === 0
            ? ' at-large'
            : `-${m.district}`
          : ''
      }${m.partyName ? ` · ${m.partyName}` : ''}`,
      linkedPerson: owners.get(`bioguide:${m.bioguideId}`) ?? null,
    });
  }
  for (const o of officials.rows.slice(0, SEARCH_LIMIT)) {
    out.push({
      kind: 'state',
      scheme: 'openstates',
      value: o.osPersonId,
      name: o.name,
      detail: `${ROLE_NAMES[o.role]}, ${o.state}${o.district ? ` district ${o.district}` : ''}${
        o.partyName ? ` · ${o.partyName}` : ''
      }`,
      linkedPerson: owners.get(`openstates:${o.osPersonId}`) ?? null,
    });
  }
  const like_ = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const people = await db
    .select({
      id: person.id,
      fullName: person.fullName,
      publishState: person.publishState,
      candidacies: sql<number>`(select count(*) from candidacy c where c.person_id = ${person}.id and c.deleted_at is null)`,
    })
    .from(person)
    .where(
      and(
        isNull(person.deletedAt),
        ne(person.id, personId),
        or(
          like(person.fullName, like_),
          like(person.preferredName, like_),
          like(person.sortName, like_),
        ),
      ),
    )
    .orderBy(asc(person.sortName))
    .limit(SEARCH_LIMIT);
  for (const p of people) {
    const n = Number(p.candidacies);
    out.push({
      kind: 'person',
      scheme: null,
      value: null,
      name: p.fullName,
      detail: n === 0 ? 'No candidacies' : `${n} ${n === 1 ? 'candidacy' : 'candidacies'}`,
      linkedPerson: { id: p.id, fullName: p.fullName, publishState: p.publishState },
    });
  }
  return out;
}

async function identifierOwners(
  db: Db | Tx,
  ids: { scheme: PersonIdentifierScheme; value: string }[],
) {
  const out = new Map<string, { id: number; fullName: string; publishState: PublishState }>();
  for (const scheme of ['bioguide', 'openstates'] as const) {
    const values = ids.filter((i) => i.scheme === scheme).map((i) => i.value);
    if (!values.length) continue;
    const rows = await db
      .select({
        value: personIdentifier.value,
        id: person.id,
        fullName: person.fullName,
        publishState: person.publishState,
      })
      .from(personIdentifier)
      .innerJoin(person, eq(person.id, personIdentifier.personId))
      .where(and(eq(personIdentifier.scheme, scheme), inArray(personIdentifier.value, values)));
    for (const r of rows) out.set(`${scheme}:${r.value}`, r);
  }
  return out;
}

/** Who carries an officeholder ID now, if anyone. */
export async function identifierOwner(
  db: Db,
  scheme: PersonIdentifierScheme,
  value: string,
): Promise<{ id: number; fullName: string; publishState: PublishState } | null> {
  return (await identifierOwners(db, [{ scheme, value }])).get(`${scheme}:${value}`) ?? null;
}

/** One side of a merge, as the preview shows it. */
export interface MergeSide {
  id: number;
  slug: string;
  fullName: string;
  preferredName: string | null;
  birthYear: number | null;
  publishState: PublishState;
  photoId: number | null;
  deletedAt: Date | null;
  mergedIntoId: number | null;
  identifiers: { scheme: PersonIdentifierScheme; value: string }[];
  candidacies: { id: number; raceId: number; raceName: string; electionName: string }[];
  claims: number;
  citations: number;
  photos: number;
}

export interface MergePreview {
  keep: MergeSide;
  merge: MergeSide;
  /** Reasons the merge can't go ahead; empty when it can. */
  problems: string[];
  /** Things worth checking before confirming. */
  warnings: string[];
  /** What the kept record will look like. */
  result: {
    fullName: string;
    slug: string;
    publishState: PublishState;
    /** Blank fields on the kept record that the merged one fills in. */
    filledIn: string[];
  };
}

async function loadSide(tx: Db | Tx, id: number): Promise<MergeSide> {
  const [p] = await tx.select().from(person).where(eq(person.id, id));
  if (!p) throw new NotFoundError('Person');
  const [identifiers, candidacies, claims, citations, photos] = await Promise.all([
    tx
      .select({ scheme: personIdentifier.scheme, value: personIdentifier.value })
      .from(personIdentifier)
      .where(eq(personIdentifier.personId, id))
      .orderBy(asc(personIdentifier.scheme)),
    tx
      .select({
        id: candidacy.id,
        raceId: candidacy.raceId,
        raceName: race.name,
        electionName: election.name,
      })
      .from(candidacy)
      .innerJoin(race, eq(race.id, candidacy.raceId))
      .innerJoin(election, eq(election.id, race.electionId))
      .where(and(eq(candidacy.personId, id), isNull(candidacy.deletedAt)))
      .orderBy(asc(election.date)),
    count(tx, claim, and(eq(claim.personId, id), isNull(claim.deletedAt))!),
    count(
      tx,
      citation,
      and(
        eq(citation.subjectType, 'person'),
        eq(citation.subjectId, id),
        isNull(citation.deletedAt),
      )!,
    ),
    count(tx, personPhoto, eq(personPhoto.personId, id)),
  ]);
  return {
    id: p.id,
    slug: p.slug,
    fullName: p.fullName,
    preferredName: p.preferredName,
    birthYear: p.birthYear,
    publishState: p.publishState,
    photoId: p.photoId,
    deletedAt: p.deletedAt,
    mergedIntoId: p.mergedIntoId,
    identifiers,
    candidacies,
    claims,
    citations,
    photos,
  };
}

async function count(
  tx: Db | Tx,
  table: typeof claim | typeof citation | typeof personPhoto,
  where: SQL,
) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(where);
  return Number(row?.n ?? 0);
}

const SCHEME_NAMES: Partial<Record<PersonIdentifierScheme, string>> = {
  bioguide: 'Bioguide (Congress)',
  openstates: 'Open States',
  fec_candidate_id: 'FEC candidate',
};

/** Exactly what merging `mergeId` into `keepId` would do, without changing anything. */
export async function previewPersonMerge(
  db: Db | Tx,
  keepId: number,
  mergeId: number,
): Promise<MergePreview> {
  const [keep, merge] = await Promise.all([loadSide(db, keepId), loadSide(db, mergeId)]);
  const problems: string[] = [];
  const warnings: string[] = [];
  if (keepId === mergeId) problems.push('These are the same record.');
  for (const side of [keep, merge]) {
    if (side.deletedAt) {
      problems.push(
        side.mergedIntoId
          ? `${side.fullName} (#${side.id}) was already merged into another record.`
          : `${side.fullName} (#${side.id}) is archived. Restore it first.`,
      );
    }
  }
  const keptRaces = new Map(keep.candidacies.map((c) => [c.raceId, c]));
  for (const c of merge.candidacies) {
    const clash = keptRaces.get(c.raceId);
    if (clash) {
      problems.push(
        `Both records are running in ${c.raceName} (${c.electionName}). Archive one of the two candidacies first, then merge.`,
      );
    }
  }
  if (keep.birthYear && merge.birthYear && keep.birthYear !== merge.birthYear) {
    warnings.push(
      `The birth years differ (${keep.birthYear} and ${merge.birthYear}). Make sure this is one person. The kept record's year stays.`,
    );
  }
  for (const id of merge.identifiers) {
    const other = keep.identifiers.find((k) => k.scheme === id.scheme && k.value !== id.value);
    if (other && (id.scheme === 'bioguide' || id.scheme === 'openstates')) {
      warnings.push(
        `Each record has its own ${SCHEME_NAMES[id.scheme] ?? id.scheme} ID (${other.value} and ${id.value}). One person should have only one. Check that they are the same person.`,
      );
    }
  }
  if (keep.fullName !== merge.fullName) {
    warnings.push(
      `The name stays “${keep.fullName}”. “${merge.fullName}” is kept in the history; edit the name afterwards if it is the better one.`,
    );
  }
  const filledIn: string[] = [];
  if (!keep.preferredName && merge.preferredName) filledIn.push('preferred name');
  if (!keep.birthYear && merge.birthYear) filledIn.push('birth year');
  if (!keep.photoId && merge.photoId) filledIn.push('photo');
  const published = keep.publishState === 'published' || merge.publishState === 'published';
  return {
    keep,
    merge,
    problems,
    warnings,
    result: {
      fullName: keep.fullName,
      slug: keep.slug,
      publishState: published ? 'published' : keep.publishState,
      filledIn,
    },
  };
}

/**
 * Merges `mergeId` into `keepId` in one transaction: moves IDs, candidacies, profile
 * entries, sources, photos, field locks and open review items, fills blank fields on the
 * kept record, and archives the merged one with a pointer to the kept one.
 */
export async function mergePeople(
  db: Db,
  actor: Actor,
  keepId: number,
  mergeId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock both rows so a concurrent edit can't slip between the preview and the move.
    await tx
      .select({ id: person.id })
      .from(person)
      .where(inArray(person.id, [keepId, mergeId]))
      .for('update');
    const preview = await previewPersonMerge(tx, keepId, mergeId);
    if (preview.problems.length) throw new CmsError(preview.problems[0]!);
    const { keep, merge } = preview;
    const note = `Merged from ${merge.fullName} (person ${mergeId}) into person ${keepId}`;

    const ids = await tx
      .select()
      .from(personIdentifier)
      .where(eq(personIdentifier.personId, mergeId));
    for (const before of ids) {
      await tx
        .update(personIdentifier)
        .set({ personId: keepId })
        .where(eq(personIdentifier.id, before.id));
      await recordChange(tx, actor, {
        entityType: 'person_identifier',
        entityId: before.id,
        action: 'merge',
        before,
        after: { ...before, personId: keepId },
        note,
      });
    }

    const candidacies = await tx.select().from(candidacy).where(eq(candidacy.personId, mergeId));
    for (const before of candidacies) {
      await tx.update(candidacy).set({ personId: keepId }).where(eq(candidacy.id, before.id));
      const [after] = await tx.select().from(candidacy).where(eq(candidacy.id, before.id));
      await recordChange(tx, actor, {
        entityType: 'candidacy',
        entityId: before.id,
        action: 'merge',
        before,
        after: after!,
        note,
      });
    }

    const claims = await tx.select().from(claim).where(eq(claim.personId, mergeId));
    for (const before of claims) {
      await tx.update(claim).set({ personId: keepId }).where(eq(claim.id, before.id));
      const [after] = await tx.select().from(claim).where(eq(claim.id, before.id));
      await recordChange(tx, actor, {
        entityType: 'claim',
        entityId: before.id,
        action: 'merge',
        before,
        after: after!,
        note,
      });
    }

    const cites = await tx
      .select()
      .from(citation)
      .where(and(eq(citation.subjectType, 'person'), eq(citation.subjectId, mergeId)));
    for (const before of cites) {
      await tx.update(citation).set({ subjectId: keepId }).where(eq(citation.id, before.id));
      await recordChange(tx, actor, {
        entityType: 'citation',
        entityId: before.id,
        action: 'merge',
        before,
        after: { ...before, subjectId: keepId },
        note,
      });
    }

    const photos = await tx
      .select({ id: personPhoto.id })
      .from(personPhoto)
      .where(eq(personPhoto.personId, mergeId));
    if (photos.length) {
      await tx
        .update(personPhoto)
        .set({ personId: keepId })
        .where(eq(personPhoto.personId, mergeId));
      for (const p of photos) {
        await recordAudit(tx, {
          actorType: 'user',
          actorId: String(actor.userId),
          action: 'merge',
          entityType: 'person_photo',
          entityId: String(p.id),
          diff: { personId: [mergeId, keepId] },
          note,
          ipAddress: actor.ipAddress ?? null,
        });
      }
    }

    // Field locks: the kept record's own locks stay; the merged record's move unless the
    // kept one already locks that field.
    const keptLocks = new Set(
      (
        await tx
          .select({ field: fieldLock.field })
          .from(fieldLock)
          .where(and(eq(fieldLock.entityType, 'person'), eq(fieldLock.entityId, keepId)))
      ).map((l) => l.field),
    );
    const locks = await tx
      .select()
      .from(fieldLock)
      .where(and(eq(fieldLock.entityType, 'person'), eq(fieldLock.entityId, mergeId)));
    for (const lock of locks) {
      if (keptLocks.has(lock.field)) {
        await tx.delete(fieldLock).where(eq(fieldLock.id, lock.id));
      } else {
        await tx.update(fieldLock).set({ entityId: keepId }).where(eq(fieldLock.id, lock.id));
      }
      await recordAudit(tx, {
        actorType: 'user',
        actorId: String(actor.userId),
        action: 'merge',
        entityType: 'field_lock',
        entityId: String(lock.id),
        diff: {
          [`person.${mergeId}.${lock.field}`]: [
            'locked',
            keptLocks.has(lock.field) ? null : `person.${keepId}`,
          ],
        },
        note,
        ipAddress: actor.ipAddress ?? null,
      });
    }

    await tx
      .update(reviewItem)
      .set({ entityId: keepId })
      .where(
        and(
          eq(reviewItem.entityType, 'person'),
          eq(reviewItem.entityId, mergeId),
          eq(reviewItem.state, 'open'),
        ),
      );

    // Anything merged into the merged record earlier now points at the kept one.
    await tx.update(person).set({ mergedIntoId: keepId }).where(eq(person.mergedIntoId, mergeId));

    const [keepBefore] = await tx.select().from(person).where(eq(person.id, keepId));
    await tx
      .update(person)
      .set({
        preferredName: keep.preferredName ?? merge.preferredName,
        birthYear: keep.birthYear ?? merge.birthYear,
        photoId: keep.photoId ?? merge.photoId,
        publishState: preview.result.publishState,
      })
      .where(eq(person.id, keepId));
    const [keepAfter] = await tx.select().from(person).where(eq(person.id, keepId));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: keepId,
      action: 'merge',
      before: keepBefore!,
      after: keepAfter!,
      note: `${note}: ${ids.length} IDs, ${candidacies.length} candidacies, ${claims.length} profile entries, ${cites.length} sources, ${photos.length} photos moved`,
    });

    const [mergeBefore] = await tx.select().from(person).where(eq(person.id, mergeId));
    await tx
      .update(person)
      .set({ deletedAt: new Date(), publishState: 'archived', mergedIntoId: keepId, photoId: null })
      .where(eq(person.id, mergeId));
    const [mergeAfter] = await tx.select().from(person).where(eq(person.id, mergeId));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: mergeId,
      action: 'merge',
      before: mergeBefore!,
      after: mergeAfter!,
      note: `Merged into ${keep.fullName} (person ${keepId}); archived`,
    });
  });
}

/**
 * Where an old profile address should go: the slug of the person a merged record was
 * merged into (following a chain of merges), or null if the slug isn't a merged record.
 */
export async function mergedProfileSlug(db: Db, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ mergedIntoId: person.mergedIntoId })
    .from(person)
    .where(eq(person.slug, slug));
  let next = row?.mergedIntoId ?? null;
  for (let hops = 0; next && hops < 10; hops++) {
    const [p] = await db
      .select({
        slug: person.slug,
        mergedIntoId: person.mergedIntoId,
        publishState: person.publishState,
        deletedAt: person.deletedAt,
      })
      .from(person)
      .where(eq(person.id, next));
    if (!p) return null;
    if (!p.mergedIntoId) {
      return p.publishState === 'published' && !p.deletedAt ? p.slug : null;
    }
    next = p.mergedIntoId;
  }
  return null;
}

/** An officeholder's name and seat, for the link preview. */
export async function describeOfficeholder(
  db: Db,
  scheme: 'bioguide' | 'openstates',
  value: string,
): Promise<{ name: string; detail: string; publicPath: string } | null> {
  if (scheme === 'bioguide') {
    const [m] = await db
      .select()
      .from(schema.congressMembership)
      .where(eq(schema.congressMembership.bioguideId, value))
      .orderBy(desc(schema.congressMembership.congress))
      .limit(1);
    if (!m) return null;
    const seat =
      m.chamber === 'senate'
        ? `U.S. Senate, ${m.state}`
        : `U.S. House, ${m.state}${m.district === 0 ? ' at-large' : m.district != null ? `-${m.district}` : ''}`;
    return {
      name: m.memberName ?? value,
      detail: `${seat}${m.partyName ? ` · ${m.partyName}` : ''} · ${m.congress}th Congress`,
      publicPath: `/politicians/${value}`,
    };
  }
  const [o] = await db
    .select()
    .from(schema.stateOfficeholder)
    .where(eq(schema.stateOfficeholder.osPersonId, value))
    .orderBy(
      sql`${schema.stateOfficeholder.leftOn} is not null`,
      desc(schema.stateOfficeholder.lastSeenOn),
    )
    .limit(1);
  if (!o) return null;
  const office = ROLE_NAMES[o.role];
  return {
    name: o.name,
    detail: `${office}, ${o.state}${o.district ? ` district ${o.district}` : ''}${
      o.partyName ? ` · ${o.partyName}` : ''
    }${o.leftOn ? ` · left office (last listed ${o.lastSeenOn})` : ''}`,
    publicPath: `/politicians/state/${value.replace(/^ocd-person\//, '')}`,
  };
}
