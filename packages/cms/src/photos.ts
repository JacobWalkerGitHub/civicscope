import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  MAX_PHOTO_BYTES,
  photoCreditSchema,
  photoLinkSchema,
  sniffPhotoType,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';
import { downloadImage } from './remote-image';

const { person, personPhoto } = schema;

async function loadPerson(tx: Tx | Db, id: number) {
  const [row] = await tx.select().from(person).where(eq(person.id, id));
  if (!row) throw new NotFoundError('Person');
  if (row.deletedAt) throw new CmsError('Restore this person before editing.');
  return row;
}

async function savePhoto(
  db: Db,
  actor: Actor,
  personId: number,
  photo: { bytes: Buffer; sourceUrl: string; credit: string; how: string },
): Promise<number> {
  if (photo.bytes.length === 0) throw new CmsError('Choose a photo.', { file: 'Choose a photo.' });
  if (photo.bytes.length > MAX_PHOTO_BYTES) {
    throw new CmsError('Photos can be up to 5 MB.', { file: 'Up to 5 MB, please.' });
  }
  const contentType = sniffPhotoType(photo.bytes);
  if (!contentType) {
    throw new CmsError('Photos must be JPEG, PNG or WebP images.', {
      file: 'Use a JPEG, PNG or WebP image.',
    });
  }
  return db.transaction(async (tx) => {
    const before = await loadPerson(tx, personId);
    const [res] = await tx.insert(personPhoto).values({
      personId,
      contentType,
      data: photo.bytes,
      byteSize: photo.bytes.length,
      sha256: createHash('sha256').update(photo.bytes).digest('hex'),
      sourceUrl: photo.sourceUrl,
      credit: photo.credit,
      uploadedBy: actor.userId,
    });
    await tx.update(person).set({ photoId: res.insertId }).where(eq(person.id, personId));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: personId,
      action: 'update',
      before,
      after: await loadPerson(tx, personId),
      note: `Photo ${photo.how} (credit: ${photo.credit}; from ${photo.sourceUrl})`,
    });
    return res.insertId;
  });
}

/** Saves an uploaded photo as the person's current photo. */
export async function uploadPersonPhoto(
  db: Db,
  actor: Actor,
  personId: number,
  bytes: Buffer,
  input: unknown,
): Promise<number> {
  const data = parseInput(photoCreditSchema, input);
  if (!data.sourceUrl) {
    throw new CmsError('Give the page the photo came from.', {
      sourceUrl: 'Where did this photo come from?',
    });
  }
  return savePhoto(db, actor, personId, {
    bytes,
    sourceUrl: data.sourceUrl,
    credit: data.credit,
    how: 'uploaded',
  });
}

/** Downloads a copy of a linked photo and makes it the person's current photo. */
export async function importPersonPhoto(
  db: Db,
  actor: Actor,
  personId: number,
  input: unknown,
): Promise<number> {
  const data = parseInput(photoLinkSchema, input);
  await loadPerson(db, personId);
  let downloaded;
  try {
    downloaded = await downloadImage(data.imageUrl);
  } catch (error) {
    if (error instanceof CmsError) throw new CmsError(error.message, { imageUrl: error.message });
    throw error;
  }
  return savePhoto(db, actor, personId, {
    bytes: downloaded.bytes,
    sourceUrl: data.sourceUrl ?? data.imageUrl,
    credit: data.credit,
    how: `copied from ${data.imageUrl}`,
  });
}

/** Stops showing a photo; the file stays in the history. */
export async function removePersonPhoto(db: Db, actor: Actor, personId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await loadPerson(tx, personId);
    if (!before.photoId) return;
    await tx.update(person).set({ photoId: null }).where(eq(person.id, personId));
    await recordChange(tx, actor, {
      entityType: 'person',
      entityId: personId,
      action: 'update',
      before,
      after: await loadPerson(tx, personId),
      note: 'Photo removed',
    });
  });
}

/** The person's current photo's details (not the bytes), for the admin page. */
export async function getCurrentPhoto(db: Db, personId: number) {
  const [row] = await db
    .select({
      id: personPhoto.id,
      contentType: personPhoto.contentType,
      byteSize: personPhoto.byteSize,
      sourceUrl: personPhoto.sourceUrl,
      credit: personPhoto.credit,
      createdAt: personPhoto.createdAt,
    })
    .from(personPhoto)
    .innerJoin(person, eq(person.photoId, personPhoto.id))
    .where(eq(person.id, personId))
    .orderBy(desc(personPhoto.id))
    .limit(1);
  return row ?? null;
}

/**
 * A photo's bytes for serving. Publicly, only the current photo of a published,
 * non-archived person is served; admins can see any person's current photo.
 */
export async function getPhotoForServing(db: Db, photoId: number, { admin = false } = {}) {
  const [row] = await db
    .select({
      data: personPhoto.data,
      contentType: personPhoto.contentType,
      sha256: personPhoto.sha256,
    })
    .from(personPhoto)
    .innerJoin(person, eq(person.photoId, personPhoto.id))
    .where(
      and(
        eq(personPhoto.id, photoId),
        isNull(person.deletedAt),
        admin ? undefined : eq(person.publishState, 'published'),
      ),
    );
  return row ?? null;
}
