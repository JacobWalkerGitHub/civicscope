import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  CmsError,
  checkUnsubscribeLink,
  confirmFollow,
  FOLLOW_LIMITS,
  requestFollow,
  sendFollowAlerts,
  unsubscribeFollow,
  type AlertsConfig,
  type OutgoingEmail,
} from '../src/index';

/* Made-up members and bills: the IDs are not real. */
let test: TestDatabase;
let db: Db;
let sourceId: number;
let sent: OutgoingEmail[] = [];
const alerts: AlertsConfig = {
  siteUrl: 'https://civicscope.test',
  send: async (email) => {
    sent.push(email);
  },
};
const SITE = alerts.siteUrl;
const t0 = new Date('2026-11-01T12:00:00Z');
const later = (h: number) => new Date(t0.getTime() + h * 3_600_000);

const linkParams = (url: string) => {
  const u = new URL(url);
  return { id: Number(u.searchParams.get('f')), token: u.searchParams.get('t') };
};
const linkIn = (text: string, path: string) => {
  const m = new RegExp(`${SITE.replace(/\./g, '\\.')}${path}\\?\\S+`).exec(text);
  if (!m) throw new Error(`No ${path} link in:\n${text}`);
  return m[0];
};

let rollNumber = 1;
async function addVote(
  votedAt: Date,
  legislation: [string, string] | null,
  casts: Record<string, string>,
) {
  const [res] = await db.insert(schema.rollCallVote).values({
    chamber: 'house',
    congress: 119,
    session: 2,
    rollNumber: rollNumber++,
    votedAt,
    question: 'On Passage',
    result: 'Passed',
    legislationType: legislation?.[0] ?? null,
    legislationNumber: legislation?.[1] ?? null,
    sourceId,
    sourceUpdatedAt: '2026-11-01',
  });
  for (const [bioguideId, voteCast] of Object.entries(casts)) {
    await db.insert(schema.votePosition).values({ voteId: res.insertId, bioguideId, voteCast });
  }
  return res.insertId;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  const [src] = await db.insert(schema.source).values({
    url: 'https://www.congress.gov/test',
    title: 'Test',
    publisher: 'Congress.gov',
    sourceType: 'legislative_record',
    retrievedAt: '2026-11-01',
  });
  sourceId = src.insertId;
  await db.insert(schema.congressMembership).values([
    {
      bioguideId: 'Z000001',
      congress: 119,
      chamber: 'house',
      state: 'KY',
      district: 6,
      memberName: 'Example, Jordan',
      startYear: 2025,
      sourceId,
      sourceUpdatedAt: '2026-01-01',
    },
    {
      bioguideId: 'Z000002',
      congress: 119,
      chamber: 'house',
      state: 'OH',
      district: 3,
      memberName: 'Hidden, Pat',
      startYear: 2025,
      sourceId,
      sourceUpdatedAt: '2026-01-01',
      publishState: 'unpublished',
    },
  ]);
  await db.insert(schema.bill).values({
    congress: 119,
    billType: 'hr',
    number: 42,
    title: 'Example Act',
    latestActionOn: '2026-10-01',
    latestActionText: 'Referred to committee.',
    sourceId,
    sourceUpdatedAt: '2026-10-01',
  });
});
afterAll(async () => {
  await test?.stop();
});
beforeEach(() => {
  sent = [];
});

async function followConfirmed(email: string, kind: 'member' | 'bill', key: string, at: Date) {
  await requestFollow(db, { email, kind, key }, { ipAddress: '203.0.113.9', alerts, now: at });
  const mail = sent.at(-1)!;
  const { id, token } = linkParams(linkIn(mail.text, '/alerts/confirm'));
  const res = await confirmFollow(db, id, token, at);
  expect(res.state).toBe('ok');
  return id;
}

describe('following', () => {
  it('sends a confirmation and nothing else until it is confirmed', async () => {
    await requestFollow(
      db,
      { email: ' Reader@Example.com ', kind: 'member', key: 'Z000001' },
      { ipAddress: '198.51.100.1', alerts, now: t0 },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('reader@example.com');
    expect(sent[0]!.text).toContain('Jordan Example');
    const [row] = await db.select().from(schema.alertFollow);
    expect(row!.confirmedAt).toBeNull();
    expect(row!.requestIp).toBe('198.51.100.1');

    // A wrong token does nothing.
    const { id, token } = linkParams(linkIn(sent[0]!.text, '/alerts/confirm'));
    expect((await confirmFollow(db, id, 'x'.repeat(32), t0)).state).toBe('invalid');

    // Asking again right away doesn't send a second email.
    await requestFollow(
      db,
      { email: 'reader@example.com', kind: 'member', key: 'Z000001' },
      { ipAddress: '198.51.100.1', alerts, now: later(0.05) },
    );
    expect(sent).toHaveLength(1);

    const res = await confirmFollow(db, id, token, later(0.1));
    expect(res.state).toBe('ok');
    const [after] = await db.select().from(schema.alertFollow).where(eq(schema.alertFollow.id, id));
    expect(after!.confirmedAt).not.toBeNull();
    // The IP address is only kept until confirmation.
    expect(after!.requestIp).toBeNull();

    // A confirmed follow is never re-confirmed by email (and the form says the same thing).
    await requestFollow(
      db,
      { email: 'reader@example.com', kind: 'member', key: 'Z000001' },
      { ipAddress: '198.51.100.1', alerts, now: later(1) },
    );
    expect(sent).toHaveLength(1);
    await db.delete(schema.alertFollow);
  });

  it('refuses unknown or unpublished targets and bad addresses', async () => {
    const opts = { ipAddress: null, alerts, now: t0 };
    await expect(
      requestFollow(db, { email: 'a@example.com', kind: 'member', key: 'Z000002' }, opts),
    ).rejects.toThrow(CmsError);
    await expect(
      requestFollow(db, { email: 'a@example.com', kind: 'bill', key: '119-hr-999' }, opts),
    ).rejects.toThrow(CmsError);
    await expect(
      requestFollow(db, { email: 'not an email', kind: 'bill', key: '119-hr-42' }, opts),
    ).rejects.toThrow(CmsError);
    expect(sent).toHaveLength(0);
  });

  it('expires confirmation links after 7 days and purges the request', async () => {
    await requestFollow(
      db,
      { email: 'slow@example.com', kind: 'bill', key: '119-hr-42' },
      { ipAddress: null, alerts, now: t0 },
    );
    const { id, token } = linkParams(linkIn(sent[0]!.text, '/alerts/confirm'));
    const tooLate = new Date(t0.getTime() + FOLLOW_LIMITS.confirmForMs + 1000);
    expect((await confirmFollow(db, id, token, tooLate)).state).toBe('expired');
    const summary = await sendFollowAlerts(db, alerts, { now: tooLate, pauseMs: 0 });
    expect(summary.purged).toBe(1);
    expect(await db.select().from(schema.alertFollow)).toHaveLength(0);
  });

  it('limits requests from one address', async () => {
    for (let i = 0; i < FOLLOW_LIMITS.perAddressPerHour; i++) {
      await requestFollow(
        db,
        { email: `flood${i}@example.com`, kind: 'bill', key: '119-hr-42' },
        { ipAddress: '192.0.2.50', alerts, now: t0 },
      );
    }
    await expect(
      requestFollow(
        db,
        { email: 'flood-last@example.com', kind: 'bill', key: '119-hr-42' },
        { ipAddress: '192.0.2.50', alerts, now: later(0.5) },
      ),
    ).rejects.toThrow(/try again later/);
    await db.delete(schema.alertFollow);
  });
});

describe('daily alerts', () => {
  it('emails only what was added after confirming, once, in one email per address', async () => {
    // Already on the site before following: never emailed.
    await addVote(later(-24), ['H.R.', '42'], { Z000001: 'Yea' });
    const memberFollow = await followConfirmed('fan@example.com', 'member', 'Z000001', t0);
    await followConfirmed('fan@example.com', 'bill', '119-hr-42', t0);

    sent = [];
    let s = await sendFollowAlerts(db, alerts, { now: later(1), pauseMs: 0 });
    expect(s).toMatchObject({ follows: 2, emailsSent: 0 });
    expect(sent).toHaveLength(0);

    // New: a vote on the bill, a bill the member sponsors, and the bill's next step.
    await addVote(later(2), ['H.R.', '42'], { Z000001: 'Nay' });
    const [b] = await db.select().from(schema.bill).where(eq(schema.bill.number, 42));
    await db.insert(schema.billSponsorship).values({
      billId: b!.id,
      bioguideId: 'Z000001',
      role: 'sponsor',
    });
    await db
      .update(schema.bill)
      .set({ latestActionOn: '2026-11-02', latestActionText: 'Passed House.' })
      .where(eq(schema.bill.id, b!.id));

    s = await sendFollowAlerts(db, alerts, { now: later(3), pauseMs: 0 });
    expect(s.emailsSent).toBe(1);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('fan@example.com');
    expect(mail.subject).toContain('2 things you follow');
    expect(mail.text).toContain('voted Nay on H.R. 42, On Passage');
    expect(mail.text).toContain('Sponsored H.R. 42: Example Act');
    expect(mail.text).toContain('Nov 2, 2026: Passed House.');
    expect(mail.text).toContain('House roll call');
    expect(mail.text).not.toContain('voted Yea');
    expect(mail.unsubscribeUrl).toContain('/api/alerts/unsubscribe?');

    // Nothing new: nothing sent.
    sent = [];
    s = await sendFollowAlerts(db, alerts, { now: later(4), pauseMs: 0 });
    expect(s.emailsSent).toBe(0);
    expect(sent).toHaveLength(0);

    // Unsubscribing from one follow leaves the other.
    const one = new URL(linkIn(mail.text, '/alerts/unsubscribe'));
    const link = { f: one.searchParams.get('f'), t: one.searchParams.get('t') };
    expect(Number(link.f)).toBe(memberFollow);
    expect((await checkUnsubscribeLink(db, { ...link, t: 'nope' })).state).toBe('invalid');
    expect(await unsubscribeFollow(db, link)).toEqual({ removed: 1 });
    expect(await unsubscribeFollow(db, link)).toBeNull();
    expect(await db.select().from(schema.alertFollow)).toHaveLength(1);

    // The one-click "stop all" link still works, and deletes the address entirely.
    const all = new URL(mail.unsubscribeUrl!);
    expect(all.searchParams.get('e')).toMatch(/^[0-9a-f]{64}$/);
    expect(all.toString()).not.toContain('fan@');
    const allLink = { e: all.searchParams.get('e'), t: all.searchParams.get('t') };
    expect(await unsubscribeFollow(db, { ...allLink, t: 'x'.repeat(32) })).toBeNull();
    expect(await unsubscribeFollow(db, allLink)).toEqual({ removed: 1 });
    expect(await db.select().from(schema.alertFollow)).toHaveLength(0);
  });

  it('keeps a follow where it was when the email fails, and retries', async () => {
    await db.delete(schema.alertFollow);
    await followConfirmed('retry@example.com', 'member', 'Z000001', later(10));
    await addVote(later(11), null, { Z000001: 'Present' });
    const failing: AlertsConfig = {
      ...alerts,
      send: async () => {
        throw new Error('SES throttled');
      },
    };
    const logs: string[] = [];
    let s = await sendFollowAlerts(db, failing, {
      now: later(12),
      pauseMs: 0,
      log: (l) => logs.push(l),
    });
    expect(s.emailsFailed).toBe(1);
    expect(logs[0]).toContain('follow_alert_failed');
    expect(logs[0]).not.toContain('retry@example.com');

    sent = [];
    s = await sendFollowAlerts(db, alerts, { now: later(13), pauseMs: 0 });
    expect(s.emailsSent).toBe(1);
    expect(sent[0]!.text).toContain('voted Present');
  });
});
