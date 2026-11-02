import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  CmsError,
  createPerson,
  getCurrentPhoto,
  getPhotoForServing,
  getPublicPerson,
  importPersonPhoto,
  removePersonPhoto,
  setPersonArchived,
  setPersonPublishState,
  uploadPersonPhoto,
  type Actor,
} from '../src/index';

/** A 1×1 PNG. Fixture data only. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const credit = { sourceUrl: 'https://campaign.example/press', credit: 'Example campaign' };

let test: TestDatabase;
let db: Db;
let actor: Actor;
let personId: number;

async function expectCmsError(promise: Promise<unknown>, match: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(CmsError);
  await expect(promise).rejects.toThrow(match);
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  const [res] = await db.insert(schema.adminUser).values({
    email: 'photos@test.local',
    name: 'Photos',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.1.1.5' };
  personId = await createPerson(db, actor, { fullName: 'Pia Photo' });
});
afterAll(async () => {
  await test?.stop();
});

describe('uploading', () => {
  it('stores a real image with its credit and makes it current, audited', async () => {
    const id = await uploadPersonPhoto(db, actor, personId, PNG, credit);
    const current = await getCurrentPhoto(db, personId);
    expect(current).toMatchObject({ id, contentType: 'image/png', credit: 'Example campaign' });
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, String(personId)))
      .orderBy(schema.auditLog.id);
    expect(audit).toBeTruthy();
    const all = await db.select().from(schema.auditLog);
    expect(all.some((a) => a.note?.startsWith('Photo uploaded'))).toBe(true);
  });

  it('rejects files that are not JPEG, PNG or WebP, whatever they claim to be', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    await expectCmsError(uploadPersonPhoto(db, actor, personId, svg, credit), /JPEG, PNG or WebP/);
    await expectCmsError(uploadPersonPhoto(db, actor, personId, Buffer.alloc(0), credit), /Choose/);
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await expectCmsError(uploadPersonPhoto(db, actor, personId, huge, credit), /5 MB/);
  });

  it('needs a credit and the page it came from', async () => {
    await expectCmsError(
      uploadPersonPhoto(db, actor, personId, PNG, { sourceUrl: '', credit: 'X campaign' }),
      /came from/,
    );
    await expectCmsError(
      uploadPersonPhoto(db, actor, personId, PNG, { ...credit, credit: '' }),
      /highlighted/,
    );
  });
});

describe('importing from a link', () => {
  it('refuses non-https links and internal addresses', async () => {
    await expectCmsError(
      importPersonPhoto(db, actor, personId, { ...credit, imageUrl: 'http://example.com/a.jpg' }),
      /highlighted/,
    );
    for (const imageUrl of [
      'https://127.0.0.1/a.png',
      'https://localhost/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.png',
    ]) {
      await expectCmsError(
        importPersonPhoto(db, actor, personId, { ...credit, imageUrl }),
        /private network/,
      );
    }
  });
});

describe('serving', () => {
  it('serves the current photo publicly only once the person is published', async () => {
    const current = await getCurrentPhoto(db, personId);
    expect(await getPhotoForServing(db, current!.id)).toBeNull();
    expect((await getPhotoForServing(db, current!.id, { admin: true }))?.data).toEqual(PNG);

    await addCitation(db, actor, {
      ...credit,
      sourceUrl: 'https://elect.example/list',
      sourceTitle: 'List',
      sourcePublisher: 'Board (example)',
      sourceType: 'official_election_authority',
      subjectType: 'person',
      subjectId: String(personId),
    });
    await setPersonPublishState(db, actor, personId, 'published');
    expect((await getPhotoForServing(db, current!.id))?.contentType).toBe('image/png');
    const profile = await getPublicPerson(db, 'pia-photo');
    expect(profile?.person).toMatchObject({
      photoId: current!.id,
      photoCredit: 'Example campaign',
    });
  });

  it('stops serving a replaced or removed photo', async () => {
    const old = (await getCurrentPhoto(db, personId))!.id;
    const replacement = await uploadPersonPhoto(db, actor, personId, PNG, credit);
    expect(await getPhotoForServing(db, old)).toBeNull();
    expect(await getPhotoForServing(db, replacement)).not.toBeNull();
    await removePersonPhoto(db, actor, personId);
    expect(await getPhotoForServing(db, replacement)).toBeNull();
    expect(await getCurrentPhoto(db, personId)).toBeNull();
  });

  it('never serves photos of archived people', async () => {
    const id = await uploadPersonPhoto(db, actor, personId, PNG, credit);
    await setPersonPublishState(db, actor, personId, 'unpublished');
    await setPersonArchived(db, actor, personId, true);
    expect(await getPhotoForServing(db, id, { admin: true })).toBeNull();
  });
});
