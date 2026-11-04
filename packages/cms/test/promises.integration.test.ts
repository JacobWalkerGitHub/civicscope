import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedIssues, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addCitation,
  addPersonIdentifier,
  addPromiseLink,
  approveClaim,
  CmsError,
  createClaim,
  createPerson,
  getClaim,
  getPublicPerson,
  listIssues,
  listPromiseRecordOptions,
  removePromiseLink,
  setPersonPublishState,
  submitClaimForReview,
  type Actor,
} from '../src/index';

let test: TestDatabase;
let db: Db;
let owner: Actor;
let reviewer: Actor;
let editor: Actor;
let personId: number;
let otherId: number;
let taxesId: number;
let billId: number;
let voteId: number;
let otherVoteId: number;

/** Fixture values for workflow tests; not statements or records of real people. */
const cite = {
  sourceUrl: 'https://campaign.example/promises',
  sourceTitle: 'Example campaign promises page',
  sourcePublisher: 'Example campaign',
  sourceType: 'campaign_site',
};
const promise = (kind = 'campaign_promise') => ({
  personId: String(personId),
  kind: 'position',
  contentKind: 'candidate_claim',
  title: 'Promises a tax cut',
  summary: 'Says they would vote to lower the federal income tax rate.',
  quote: 'I will vote to cut your taxes.',
  issueId: String(taxesId),
  positionType: kind,
});

async function expectCmsError(p: Promise<unknown>, match: RegExp) {
  await expect(p).rejects.toBeInstanceOf(CmsError);
  await expect(p).rejects.toThrow(match);
}

async function user(email: string, role: 'owner' | 'reviewer' | 'editor'): Promise<Actor> {
  const [res] = await db
    .insert(schema.adminUser)
    .values({ email, name: email.split('@')[0]!, passwordHash: 'x', role });
  return { userId: res.insertId, ipAddress: '10.1.1.4' };
}

async function publishedPromise(kind = 'campaign_promise') {
  const id = await createClaim(db, editor, promise(kind));
  await addCitation(db, editor, { ...cite, subjectType: 'claim', subjectId: String(id) });
  await submitClaimForReview(db, editor, id);
  await approveClaim(db, reviewer, id);
  return id;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  owner = await user('owner@test.local', 'owner');
  reviewer = await user('reviewer@test.local', 'reviewer');
  editor = await user('editor@test.local', 'editor');
  await seedIssues(db);
  taxesId = (await listIssues(db)).find((i) => i.name === 'Taxes and budget')!.id;
  personId = await createPerson(db, owner, { fullName: 'Example Promise Person' });
  otherId = await createPerson(db, owner, { fullName: 'Example Other Person' });
  for (const id of [personId, otherId]) {
    await addCitation(db, owner, { ...cite, subjectType: 'person', subjectId: String(id) });
    await setPersonPublishState(db, owner, id, 'published');
  }
  await addPersonIdentifier(db, owner, personId, { scheme: 'bioguide', value: 'X000101' });
  await addPersonIdentifier(db, owner, otherId, { scheme: 'bioguide', value: 'X000102' });

  const [src] = await db.insert(schema.source).values({
    url: 'https://www.congress.gov/example',
    title: 'Example record',
    publisher: 'Congress.gov',
    sourceType: 'government_record',
    retrievedAt: '2026-01-05',
  });
  const [b] = await db.insert(schema.bill).values({
    congress: 119,
    billType: 'hr',
    number: 9001,
    title: 'Example Tax Relief Act',
    sourceId: src.insertId,
    sourceUpdatedAt: '2026-01-05T00:00:00Z',
    latestActionText: 'Referred to the Committee on Ways and Means.',
  });
  billId = b.insertId;
  await db.insert(schema.billSponsorship).values({
    billId,
    bioguideId: 'X000101',
    role: 'sponsor',
    sponsoredOn: '2026-01-03',
  });
  const vote = async (roll: number, who: string, cast: string) => {
    const [v] = await db.insert(schema.rollCallVote).values({
      chamber: 'house',
      congress: 119,
      session: 2,
      rollNumber: roll,
      votedAt: new Date('2026-02-10T15:00:00Z'),
      question: 'On Passage',
      result: 'Passed',
      legislationType: 'HR',
      legislationNumber: '9001',
      sourceId: src.insertId,
      sourceUpdatedAt: '2026-02-10T00:00:00Z',
    });
    await db
      .insert(schema.votePosition)
      .values({ voteId: v.insertId, bioguideId: who, voteCast: cast });
    return v.insertId;
  };
  voteId = await vote(41, 'X000101', 'Yea');
  otherVoteId = await vote(42, 'X000102', 'Nay');
});
afterAll(async () => {
  await test?.stop();
});

describe('promises and record', () => {
  it('offers only the person’s own bills and votes', async () => {
    const opts = await listPromiseRecordOptions(db, personId);
    expect(opts.bills.map((b) => [b.recordId, b.label, b.action])).toEqual([
      [billId, 'H.R. 9001', 'Sponsor'],
    ]);
    expect(opts.votes.map((v) => [v.recordId, v.action])).toEqual([[voteId, 'Yea']]);
  });

  it('links records to campaign promises only, and only the person’s own', async () => {
    const stated = await createClaim(db, editor, promise('stated_position'));
    await expectCmsError(
      addPromiseLink(db, editor, stated, {
        record: `bill:${billId}`,
        note: 'Bill to cut income taxes.',
      }),
      /Only campaign promises/,
    );
    const id = await createClaim(db, editor, promise());
    await expectCmsError(
      addPromiseLink(db, editor, id, {
        record: `vote:${otherVoteId}`,
        note: 'Vote on the tax bill.',
      }),
      /isn’t one of this person’s/,
    );
    await expectCmsError(addPromiseLink(db, editor, id, { record: 'bill:x', note: 'x' }), /./);
    await addPromiseLink(db, editor, id, {
      record: `bill:${billId}`,
      note: 'Bill to cut income taxes.',
    });
    await expectCmsError(
      addPromiseLink(db, editor, id, { record: `bill:${billId}`, note: 'Same bill again here.' }),
      /already linked/,
    );
  });

  it('sends a published promise back to review when an editor changes its record', async () => {
    const id = await publishedPromise();
    const linkId = await addPromiseLink(db, editor, id, {
      record: `vote:${voteId}`,
      note: 'House vote on passage of the tax bill.',
    });
    let c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus]).toEqual(['unpublished', 'pending_review']);
    expect(
      (await getPublicPerson(db, 'example-promise-person'))!.claims.map((x) => x.id),
    ).not.toContain(id);

    await approveClaim(db, reviewer, id);
    const profile = (await getPublicPerson(db, 'example-promise-person'))!;
    const record = profile.promiseRecords.get(id)!;
    expect(record.map((r) => [r.recordType, r.action, r.outcome, r.note])).toEqual([
      ['vote', 'Yea', 'Passed', 'House vote on passage of the tax bill.'],
    ]);
    expect(record[0]!.sourceUrl).toBe('https://clerk.house.gov/Votes/202641');

    // A reviewer's change stays published, re-verified by them.
    await removePromiseLink(db, reviewer, linkId);
    c = await getClaim(db, id);
    expect([c.publishState, c.verificationStatus, c.verifiedBy]).toEqual([
      'published',
      'verified',
      reviewer.userId,
    ]);
    expect(
      (await getPublicPerson(db, 'example-promise-person'))!.promiseRecords.get(id),
    ).toBeUndefined();
  });

  it('hides records that are taken off the public site', async () => {
    const id = await publishedPromise();
    await addPromiseLink(db, reviewer, id, {
      record: `bill:${billId}`,
      note: 'Bill to cut income taxes.',
    });
    expect(
      (await getPublicPerson(db, 'example-promise-person'))!.promiseRecords.get(id),
    ).toHaveLength(1);
    await db
      .update(schema.bill)
      .set({ publishState: 'unpublished' })
      .where(eq(schema.bill.id, billId));
    expect(
      (await getPublicPerson(db, 'example-promise-person'))!.promiseRecords.get(id),
    ).toBeUndefined();
    await db.update(schema.bill).set({ publishState: 'draft' }).where(eq(schema.bill.id, billId));
  });
});
