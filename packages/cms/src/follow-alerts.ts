/**
 * The daily follow-alert run: for every confirmed follow, what was added to the site
 * since its last email, gathered into one email per address. A follow only moves
 * past what it has seen once its email is sent, so a failed send is retried on the
 * next run. Records are listed as published, without commentary.
 */
import { and, asc, eq, gt, gte, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { billLabel, isBillType } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { voteIsOnBill } from './bills';
import type { AlertsConfig } from './email';
import {
  actionMark,
  billState,
  followPath,
  globalMarks,
  latestFiling,
  purgeUnconfirmedFollows,
  stopAllUrl,
  unsubscribeUrl,
  type FollowMarks,
  type GlobalMarks,
} from './follows';

const { alertFollow, bill, billSponsorship, rollCallVote, votePosition } = schema;

const shown = (t: { publishState: MySqlColumn }) =>
  notInArray(t.publishState, ['unpublished', 'archived']);

/** Votes older than this are left out, so a backfill of old records doesn't flood inboxes. */
const RECENT_DAYS = 30;
/** Items listed per kind of update; the rest are counted and linked. */
const LIST_LIMIT = 10;

type Follow = typeof alertFollow.$inferSelect;

export interface FollowUpdate {
  heading: string;
  lines: string[];
}

const day = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const isoDay = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function capped(lines: string[], more: string): string[] {
  if (lines.length <= LIST_LIMIT) return lines;
  return [...lines.slice(0, LIST_LIMIT), `  …and ${lines.length - LIST_LIMIT} more ${more}`];
}

function voteBillLabel(congress: number, type: string | null, number: string | null) {
  const t = type?.toLowerCase().replace(/[.\s]/g, '') ?? '';
  const n = Number(number);
  return isBillType(t) && Number.isInteger(n) && n > 0 ? billLabel(t, n) : null;
}

/** What's new for one follow, and the marks to store once it has been emailed. */
export async function followUpdates(
  db: Db,
  follow: Follow,
  g: GlobalMarks,
  now: Date,
): Promise<{ updates: FollowUpdate[]; marks: FollowMarks }> {
  const updates: FollowUpdate[] = [];
  const marks: FollowMarks = {
    seenVoteId: g.maxVoteId,
    seenSponsorshipId: g.maxSponsorshipId,
    seenAction: follow.seenAction,
    seenFilingEnd: follow.seenFilingEnd,
  };
  const recent = new Date(now.getTime() - RECENT_DAYS * 24 * 3_600_000);
  const newVotes = and(
    gt(rollCallVote.id, follow.seenVoteId),
    lte(rollCallVote.id, g.maxVoteId),
    gte(rollCallVote.votedAt, recent),
    shown(rollCallVote),
  );

  if (follow.kind === 'member') {
    const votes = await db
      .select({
        congress: rollCallVote.congress,
        votedAt: rollCallVote.votedAt,
        question: rollCallVote.question,
        result: rollCallVote.result,
        legislationType: rollCallVote.legislationType,
        legislationNumber: rollCallVote.legislationNumber,
        voteCast: votePosition.voteCast,
      })
      .from(votePosition)
      .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
      .where(and(eq(votePosition.bioguideId, follow.targetKey), newVotes))
      .orderBy(asc(rollCallVote.votedAt));
    if (votes.length) {
      updates.push({
        heading: votes.length === 1 ? 'New recorded vote' : `${votes.length} new recorded votes`,
        lines: capped(
          votes.map((v) => {
            const on = voteBillLabel(v.congress, v.legislationType, v.legislationNumber);
            const what = [on, v.question].filter(Boolean).join(', ');
            return `- ${day.format(v.votedAt)}: voted ${v.voteCast} on ${what || 'a recorded vote'}${v.result ? ` (${v.result})` : ''}`;
          }),
          'on the page',
        ),
      });
    }

    const bills = await db
      .select({
        congress: bill.congress,
        billType: bill.billType,
        number: bill.number,
        title: bill.title,
        role: billSponsorship.role,
      })
      .from(billSponsorship)
      .innerJoin(bill, eq(bill.id, billSponsorship.billId))
      .where(
        and(
          eq(billSponsorship.bioguideId, follow.targetKey),
          gt(billSponsorship.id, follow.seenSponsorshipId),
          lte(billSponsorship.id, g.maxSponsorshipId),
          isNull(billSponsorship.withdrawnOn),
          shown(bill),
        ),
      )
      .orderBy(asc(billSponsorship.id));
    if (bills.length) {
      updates.push({
        heading: bills.length === 1 ? 'New bill' : `${bills.length} new bills`,
        lines: capped(
          bills.map((b) => {
            const title = b.title.length > 140 ? `${b.title.slice(0, 137)}…` : b.title;
            return `- ${b.role === 'sponsor' ? 'Sponsored' : 'Cosponsored'} ${billLabel(b.billType, b.number)}: ${title}`;
          }),
          'on the page',
        ),
      });
    }

    const filing = await latestFiling(db, follow.targetKey);
    if (filing?.coverageEnd && filing.coverageEnd !== follow.seenFilingEnd) {
      // A later period is news (the mark was set when the follow was confirmed).
      if (!follow.seenFilingEnd || filing.coverageEnd > follow.seenFilingEnd) {
        const money = [
          filing.receipts != null && `raised ${usd.format(filing.receipts)}`,
          filing.disbursements != null && `spent ${usd.format(filing.disbursements)}`,
          filing.cashOnHand != null && `${usd.format(filing.cashOnHand)} cash on hand`,
        ].filter(Boolean);
        updates.push({
          heading: 'New campaign finance report (FEC)',
          lines: [
            `- ${filing.cycle - 1}–${filing.cycle} totals through ${isoDay(filing.coverageEnd)}${money.length ? `: ${money.join(', ')}` : ''}`,
            `  https://www.fec.gov/data/candidate/${filing.candidateId}/`,
          ],
        });
      }
      marks.seenFilingEnd = filing.coverageEnd;
    }
  } else {
    const b = await billState(db, follow.targetKey);
    if (b) {
      const mark = actionMark(b.latestActionOn, b.latestActionText);
      if (mark && mark !== follow.seenAction) {
        updates.push({
          heading: 'Latest action',
          lines: [
            `- ${b.latestActionOn ? `${isoDay(b.latestActionOn)}: ` : ''}${b.latestActionText ?? 'Status updated'}`,
          ],
        });
        marks.seenAction = mark;
      }
      const votes = await db
        .select({
          chamber: rollCallVote.chamber,
          rollNumber: rollCallVote.rollNumber,
          votedAt: rollCallVote.votedAt,
          question: rollCallVote.question,
          result: rollCallVote.result,
        })
        .from(rollCallVote)
        .where(and(voteIsOnBill(b), newVotes))
        .orderBy(asc(rollCallVote.votedAt));
      if (votes.length) {
        updates.push({
          heading: votes.length === 1 ? 'New recorded vote' : `${votes.length} new recorded votes`,
          lines: capped(
            votes.map(
              (v) =>
                `- ${day.format(v.votedAt)}: ${v.chamber === 'house' ? 'House' : 'Senate'} roll call ${v.rollNumber}, ${v.question ?? 'vote'}${v.result ? ` (${v.result})` : ''}`,
            ),
            'on the page',
          ),
        });
      }
    }
  }
  return { updates, marks };
}

export function digestEmail(
  siteUrl: string,
  email: string,
  items: { follow: Follow; updates: FollowUpdate[] }[],
) {
  const first = items[0]!.follow;
  const subject =
    items.length === 1
      ? `CivicScope: news on ${first.targetLabel.split(': ')[0]}`
      : `CivicScope: news on ${items.length} things you follow`;
  const body: string[] = ['Here’s what was added to CivicScope since our last email.', ''];
  for (const { follow, updates } of items) {
    body.push(follow.targetLabel, `${siteUrl}${followPath(follow.kind, follow.targetKey)}`);
    for (const u of updates) body.push('', `${u.heading}:`, ...u.lines);
    body.push('', `Stop following this: ${unsubscribeUrl(siteUrl, follow)}`, '', '');
  }
  body.push(
    '—',
    'Votes and bills come from Congress.gov and the House and Senate; money from the FEC.',
    'CivicScope lists records as published, without commentary.',
    '',
    `Stop all CivicScope emails to ${email}: ${stopAllUrl(siteUrl, email)}`,
  );
  return {
    to: email,
    subject,
    text: body.join('\n'),
    unsubscribeUrl: stopAllUrl(siteUrl, email, { oneClick: true }),
  };
}

export interface FollowAlertSummary {
  purged: number;
  follows: number;
  emailsSent: number;
  emailsFailed: number;
}

export async function sendFollowAlerts(
  db: Db,
  alerts: AlertsConfig,
  { now = new Date(), log = (line: string) => console.log(line), pauseMs = 100 } = {},
): Promise<FollowAlertSummary> {
  const purged = await purgeUnconfirmedFollows(db, now);
  const follows = await db
    .select()
    .from(alertFollow)
    .where(isNotNull(alertFollow.confirmedAt))
    .orderBy(asc(alertFollow.email), asc(alertFollow.id));
  const g = await globalMarks(db);
  const byEmail = new Map<string, Follow[]>();
  for (const f of follows) byEmail.set(f.email, [...(byEmail.get(f.email) ?? []), f]);

  let emailsSent = 0;
  let emailsFailed = 0;
  for (const [email, list] of byEmail) {
    const results = [];
    for (const follow of list)
      results.push({ follow, ...(await followUpdates(db, follow, g, now)) });
    const news = results.filter((r) => r.updates.length);
    let sent = false;
    if (news.length) {
      try {
        await alerts.send(digestEmail(alerts.siteUrl, email, news));
        sent = true;
        emailsSent++;
        if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      } catch (error) {
        emailsFailed++;
        log(
          JSON.stringify({
            level: 'error',
            event: 'follow_alert_failed',
            followIds: news.map((n) => n.follow.id),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        // Leave every follow for this address where it was, so the next run retries.
        continue;
      }
    }
    for (const r of results) {
      await db
        .update(alertFollow)
        .set({ ...r.marks, ...(sent && r.updates.length ? { lastSentAt: now } : {}) })
        .where(eq(alertFollow.id, r.follow.id));
    }
  }
  return { purged, follows: follows.length, emailsSent, emailsFailed };
}
