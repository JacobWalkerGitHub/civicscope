import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedIssues, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  approveClaim,
  CmsError,
  countReviewQueue,
  createClaim,
  createIssue,
  createPerson,
  getClaim,
  listIssues,
  listReviewQueue,
  removeCitation,
  republishClaim,
  restoreRevision,
  sendClaimBack,
  setClaimArchived,
  setIssueArchived,
  setPersonArchived,
  setPersonPublishState,
  submitClaimForReview,
  unpublishClaim,
  updateClaim,
  updateIssue,
  type Actor,
} from '../src/index';

let test: TestDatabase;
let db: Db;
let owner: Actor;
let reviewer: Actor;
let reviewer2: Actor;
let editor: Actor;
let personId: number;
let taxesId: number;

/** Fixture values for workflow tests; not statements by real people. */
const source = {
  sourceUrl: 'https://campaign.example/issues',
  sourceTitle: 'Example campaign issues page',
  sourcePublisher: 'Example campaign',
  sourceType: 'campaign_site',
};
const position = () => ({
  personId: String(personId),
  kind: 'position',
  contentKind: 'candidate_claim',
  title: 'Proposes an income tax cut',
  summary: 'Says they would propose lowering the state income tax rate.',
  quote: 'We will lower the income tax.',
  issueId: String(taxesId),
  positionType: 'campaign_promise',
});

async function expectCmsError(promise: Promise<unknown>, match: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(CmsError);
  await expect(promise).rejects.toThrow(match);
}

async function user(email: string, role: 'owner' | 'reviewer' | 'editor'): Promise<Actor> {
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email, name: email.split('@')[0]!, passwordHash: 'x', role });
  return { userId: res.insertId, ipAddress: '10.1.1.3' };
}

async function citedClaim(input = position(), by: Actor = editor) {
  const id = await createClaim(db, by, input);
  await addCitation(db, by, { ...source, subjectType: 'claim', subjectId: String(id) });
  return id;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  owner = await user('owner@test.local', 'owner');
  reviewer = await user('reviewer@test.local', 'reviewer');
  reviewer2 = await user('reviewer2@test.local', 'reviewer');
  editor = await user('editor@test.local', 'editor');
  await seedIssues(db);
  taxesId = (await listIssues(db)).find((i) => i.name === 'Taxes and budget')!.id;
  personId = await createPerson(db, owner, { fullName: 'Example Profile Person' });
  await addCitation(db, owner, { ...source, subjectType: 'person', subjectId: String(personId) });
  await setPersonPublishState(db, owner, personId, 'published');
});
afterAll(async () => {
  await test?.stop();
});

describe('issues', () => {
  it('seeds a default list once, and can be extended, renamed and archived', async () => {
    expect((await seedIssues(db)).inserted).toBe(0);
    const id = await createIssue(db, owner, { name: 'Example issue' });
    await expectCmsError(createIssue(db, owner, { name: 'Example issue' }), /already exists/);
    await updateIssue(db, owner, id, { name: 'Renamed example issue' });
    await setIssueArchived(db, owner, id, true);
    expect((await listIssues(db)).some((i) => i.id === id)).toBe(false);
  });

  it('cannot archive an issue that positions are filed under', async () => {
    await createClaim(db, editor, position());
    await expectCmsError(setIssueArchived(db, owner, taxesId, true), /filed under this issue/);
  });
});

describe('review workflow', () => {
  it('needs a source before review, then a different reviewer to approve', async () => {
    const id = await createClaim(db, editor, position());
    await expectCmsError(submitClaimForReview(db, editor, id), /at least one source/);
    await addCitation(db, editor, { ...source, subjectType: 'claim', subjectId: String(id) });
    await submitClaimForReview(db, editor, id);
    expect((await listReviewQueue(db)).map((q) => q.id)).toContain(id);

    await expectCmsError(approveClaim(db, editor, id), /Only reviewers/);
    await approveClaim(db, reviewer, id, 'Checked against the campaign page.');
    const c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus, c.verifiedBy]).toEqual([
      'published',
      'verified',
      reviewer.userId,
    ]);
    expect((await listReviewQueue(db)).map((q) => q.id)).not.toContain(id);

    // The database itself refuses a published entry that was never verified.
    await expect(
      db.execute(sql`UPDATE claim SET verification_status = 'unverified' WHERE id = ${id}`),
    ).rejects.toThrow();
  });

  it('stops reviewers approving their own edits, but lets the owner', async () => {
    const id = await citedClaim(position(), reviewer);
    await submitClaimForReview(db, reviewer, id);
    await expectCmsError(approveClaim(db, reviewer, id), /another reviewer/);
    await approveClaim(db, reviewer2, id);

    const mine = await citedClaim(position(), owner);
    await submitClaimForReview(db, owner, mine);
    await approveClaim(db, owner, mine);
    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, String(mine)))
      .orderBy(sql`id desc`)
      .limit(1);
    expect(entry!.note).toMatch(/owner who wrote it/);
  });

  it('sends an entry back with a note for its author', async () => {
    const id = await citedClaim();
    await submitClaimForReview(db, editor, id);
    await expectCmsError(sendClaimBack(db, reviewer, id, '  '), /Say what needs to change/);
    await sendClaimBack(db, reviewer, id, 'The quote is missing a sentence.');
    const c = await getClaim(db, id);
    expect([c.verificationStatus, c.reviewNote, c.publishState]).toEqual([
      'unverified',
      'The quote is missing a sentence.',
      'draft',
    ]);
  });

  it('takes a published entry down when an editor changes it, until it is reviewed', async () => {
    const id = await citedClaim();
    await submitClaimForReview(db, editor, id);
    await approveClaim(db, reviewer, id);

    await updateClaim(db, editor, id, { ...position(), summary: 'A changed summary, unreviewed.' });
    let c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus]).toEqual(['unpublished', 'pending_review']);
    expect((await listReviewQueue(db)).find((q) => q.id === id)?.wasPublished).toBeTruthy();

    await approveClaim(db, reviewer, id);
    // A reviewer's own edit to a published entry stays up, verified by them.
    await updateClaim(db, reviewer, id, { ...position(), title: 'Proposes a tax cut' });
    c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus, c.verifiedBy]).toEqual([
      'published',
      'verified',
      reviewer.userId,
    ]);

    // Saving with no real change doesn't send it anywhere.
    const before = await countReviewQueue(db);
    await updateClaim(db, editor, id, { ...position(), title: 'Proposes a tax cut' });
    expect(await countReviewQueue(db)).toBe(before);
  });

  it('keeps the last source of a published entry and protects its person', async () => {
    const id = await citedClaim();
    await submitClaimForReview(db, editor, id);
    await approveClaim(db, reviewer, id);
    const [cite] = await db.select().from(schema.citation).where(eq(schema.citation.subjectId, id));
    await expectCmsError(removeCitation(db, editor, cite!.id), /only source/);
    await expectCmsError(
      setPersonPublishState(db, owner, personId, 'unpublished'),
      /profile entries first/,
    );
    await expectCmsError(setPersonArchived(db, owner, personId, true), /candidacies|profile/);

    await unpublishClaim(db, reviewer, id);
    expect((await getClaim(db, id)).verificationStatus).toBe('verified');
    await republishClaim(db, reviewer, id);
    expect((await getClaim(db, id)).publishState).toBe('published');
  });

  it('needs the person to be published before approval', async () => {
    const draftPerson = await createPerson(db, owner, { fullName: 'Example Draft Person' });
    const id = await citedClaim({ ...position(), personId: String(draftPerson) });
    await submitClaimForReview(db, editor, id);
    await expectCmsError(approveClaim(db, reviewer, id), /Publish the person first/);
  });

  it('starts a restored entry over as unverified, and restores old versions', async () => {
    const id = await citedClaim();
    await updateClaim(db, editor, id, { ...position(), title: 'A second title' });
    await restoreRevision(db, owner, 'claim', id, 1);
    expect((await getClaim(db, id)).title).toBe('Proposes an income tax cut');

    await setClaimArchived(db, reviewer, id, true);
    await setClaimArchived(db, reviewer, id, false);
    const c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus]).toEqual(['draft', 'unverified']);
  });

  it('records biography entries with their own fields', async () => {
    const id = await createClaim(db, editor, {
      personId: String(personId),
      kind: 'biography',
      bioCategory: 'education',
      contentKind: 'sourced_fact',
      title: 'B.A., Example University',
      summary: 'Earned a bachelor’s degree from Example University.',
      organization: 'Example University',
      endYear: '2004',
    });
    const c = await getClaim(db, id);
    expect([c.kind, c.bioCategory, c.issueId]).toEqual(['biography', 'education', null]);
  });
});
