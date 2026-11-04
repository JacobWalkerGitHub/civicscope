/**
 * Follow a Member of Congress or a bill and get an email when something new is
 * recorded: a vote, a bill they sponsor, a new campaign finance report, or a bill's
 * next step. Double opt-in: nothing is sent but the confirmation email until the
 * reader clicks its link, and an unconfirmed request is deleted after 7 days.
 *
 * Links in emails carry a signature (HMAC) instead of a stored token:
 *   confirm      signs the follow's id and the moment the confirmation was sent, so
 *                sending a new confirmation retires the old link;
 *   unsubscribe  signs the follow's id and email, and works until the row is gone;
 *   stop all     signs the email address alone, and carries only its SHA-256 hash, so
 *                it keeps working after single follows are stopped.
 * The key is derived from AUTH_ENCRYPTION_KEY, which the web app and workers share.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { z } from 'zod';
import {
  BIOGUIDE_ID,
  billLabel,
  isBillType,
  type BillType,
  type FollowKind,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { memberRefs } from './bills';
import type { AlertsConfig } from './email';
import { CmsError } from './errors';
import { parseInput } from './parse';

const {
  alertFollow,
  bill,
  billSponsorship,
  congressMembership,
  fecCandidateTotals,
  personIdentifier,
  rollCallVote,
} = schema;

export const FOLLOW_LIMITS = {
  /** Follow requests from one IP address in an hour. */
  perAddressPerHour: 10,
  /** Follow requests across the whole site in an hour. */
  totalPerHour: 300,
  /** Unconfirmed requests for one email address in a day before we stop sending. */
  pendingPerEmailPerDay: 5,
  /** A repeat request for the same follow doesn't resend sooner than this. */
  resendAfterMs: 10 * 60_000,
  /** How long a confirmation link works, and how long an unconfirmed request is kept. */
  confirmForMs: 7 * 24 * 3_600_000,
} as const;

const shown = (t: { publishState: MySqlColumn }) =>
  notInArray(t.publishState, ['unpublished', 'archived']);

// ---------------------------------------------------------------------------------
// Signed links

const DEV_KEY = createHash('sha256').update('civicscope-development-only-key').digest();

function signingKey(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  let base: Buffer;
  if (raw) base = Buffer.from(raw, 'base64');
  else if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_ENCRYPTION_KEY is not set.');
  } else base = DEV_KEY;
  // A key of its own, so these signatures can never be confused with anything else.
  return createHmac('sha256', base).update('civicscope follow links v1').digest();
}

function sign(message: string): string {
  return createHmac('sha256', signingKey()).update(message).digest('base64url').slice(0, 32);
}

function signatureMatches(expected: string, given: string | null | undefined): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

const confirmMessage = (id: number, requestedAt: Date) => `confirm:${id}:${requestedAt.getTime()}`;
const unsubscribeMessage = (id: number, email: string) => `unsubscribe:${id}:${email}`;
const stopAllMessage = (email: string) => `stop-all:${email}`;
const emailHash = (email: string) => createHash('sha256').update(email).digest('hex');

export function confirmUrl(siteUrl: string, f: { id: number; requestedAt: Date }): string {
  const t = sign(confirmMessage(f.id, f.requestedAt));
  return `${siteUrl}/alerts/confirm?f=${f.id}&t=${t}`;
}

/** The page with an Unsubscribe button for one follow. */
export function unsubscribeUrl(siteUrl: string, f: { id: number; email: string }): string {
  return `${siteUrl}/alerts/unsubscribe?f=${f.id}&t=${sign(unsubscribeMessage(f.id, f.email))}`;
}

/**
 * Stops every follow for an address: the page with a button, or with `oneClick` the
 * address mail apps POST to (List-Unsubscribe).
 */
export function stopAllUrl(siteUrl: string, email: string, { oneClick = false } = {}): string {
  const path = oneClick ? '/api/alerts/unsubscribe' : '/alerts/unsubscribe';
  return `${siteUrl}${path}?e=${emailHash(email)}&t=${sign(stopAllMessage(email))}`;
}

/** The query of an unsubscribe link: a follow id (`f`) or an address hash (`e`). */
export interface UnsubscribeLink {
  f?: string | null;
  e?: string | null;
  t?: string | null;
}

// ---------------------------------------------------------------------------------
// Targets

export interface FollowTarget {
  kind: FollowKind;
  key: string;
  label: string;
  path: string;
}

const BILL_KEY = /^(\d{1,3})-([a-z]{1,7})-(\d{1,6})$/;

export function billFollowKey(b: { congress: number; billType: string; number: number }): string {
  return `${b.congress}-${b.billType}-${b.number}`;
}

function parseBillKey(
  key: string,
): { congress: number; billType: BillType; number: number } | null {
  const m = BILL_KEY.exec(key);
  if (!m || !isBillType(m[2]!)) return null;
  return { congress: Number(m[1]), billType: m[2], number: Number(m[3]) };
}

export function followPath(kind: FollowKind, key: string): string {
  if (kind === 'member') return `/politicians/${key}`;
  const b = parseBillKey(key);
  return b ? `/bills/${b.congress}/${b.billType}/${b.number}` : '/bills';
}

/** The member or bill a follow points at, if it is on the public site. */
export async function findFollowTarget(
  db: Db,
  kind: FollowKind,
  key: string,
): Promise<FollowTarget | null> {
  if (kind === 'member') {
    if (!BIOGUIDE_ID.test(key)) return null;
    const [m] = await db
      .select({ id: congressMembership.id })
      .from(congressMembership)
      .where(and(eq(congressMembership.bioguideId, key), shown(congressMembership)))
      .limit(1);
    if (!m) return null;
    const ref = (await memberRefs(db, [key])).get(key)!;
    return { kind, key, label: ref.name, path: followPath(kind, key) };
  }
  const parsed = parseBillKey(key);
  if (!parsed) return null;
  const [b] = await db
    .select({ title: bill.title })
    .from(bill)
    .where(
      and(
        eq(bill.congress, parsed.congress),
        eq(bill.billType, parsed.billType),
        eq(bill.number, parsed.number),
        shown(bill),
      ),
    );
  if (!b) return null;
  const label = billLabel(parsed.billType, parsed.number);
  const title = b.title.length > 120 ? `${b.title.slice(0, 117)}…` : b.title;
  return { kind, key, label: `${label}: ${title}`, path: followPath(kind, key) };
}

// ---------------------------------------------------------------------------------
// Following

const followRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'That email address is too long.')
    .pipe(z.email('Enter an email address, like name@example.com.')),
  kind: z.enum(['member', 'bill']),
  key: z.string().trim().min(1).max(40),
});

/**
 * Records a follow request and emails a confirmation link. Answers the same way
 * whether or not an email went out, so the form never reveals what an address
 * already follows. Throws CmsError for bad input or when the form is being flooded.
 */
export async function requestFollow(
  db: Db,
  input: unknown,
  opts: { ipAddress: string | null; alerts: AlertsConfig; now?: Date },
): Promise<void> {
  const data = parseInput(followRequestSchema, input);
  const now = opts.now ?? new Date();
  const target = await findFollowTarget(db, data.kind, data.key);
  if (!target) throw new CmsError('That page can’t be followed.');

  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [total] = await db
    .select({ n: count() })
    .from(alertFollow)
    .where(gte(alertFollow.requestedAt, hourAgo));
  const [mine] = opts.ipAddress
    ? await db
        .select({ n: count() })
        .from(alertFollow)
        .where(
          and(eq(alertFollow.requestIp, opts.ipAddress), gte(alertFollow.requestedAt, hourAgo)),
        )
    : [{ n: 0 }];
  if (
    (total?.n ?? 0) >= FOLLOW_LIMITS.totalPerHour ||
    (mine?.n ?? 0) >= FOLLOW_LIMITS.perAddressPerHour
  ) {
    throw new CmsError('We’ve had a lot of requests in the last hour. Please try again later.');
  }

  const where = and(
    eq(alertFollow.email, data.email),
    eq(alertFollow.kind, data.kind),
    eq(alertFollow.targetKey, data.key),
  );
  const [existing] = await db.select().from(alertFollow).where(where);
  if (existing?.confirmedAt) return;
  if (existing && now.getTime() - existing.requestedAt.getTime() < FOLLOW_LIMITS.resendAfterMs) {
    return;
  }
  const [pending] = await db
    .select({ n: count() })
    .from(alertFollow)
    .where(
      and(
        eq(alertFollow.email, data.email),
        isNull(alertFollow.confirmedAt),
        gte(alertFollow.requestedAt, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    );
  if ((pending?.n ?? 0) >= FOLLOW_LIMITS.pendingPerEmailPerDay) return;

  if (existing) {
    await db
      .update(alertFollow)
      .set({ requestedAt: now, requestIp: opts.ipAddress, targetLabel: target.label })
      .where(eq(alertFollow.id, existing.id));
  } else {
    await db.insert(alertFollow).values({
      email: data.email,
      kind: data.kind,
      targetKey: data.key,
      targetLabel: target.label,
      requestedAt: now,
      requestIp: opts.ipAddress,
    });
  }
  // Sign what the database stored, so the link matches it to the millisecond.
  const [row] = await db.select().from(alertFollow).where(where);
  if (!row) return;

  try {
    await opts.alerts.send({
      to: row.email,
      subject: `Confirm: email updates on ${shortLabel(target.label)}`,
      text: [
        `Someone (we hope you) asked CivicScope to email this address when there is news about:`,
        '',
        `  ${target.label}`,
        `  ${opts.alerts.siteUrl}${target.path}`,
        '',
        'To start getting these emails, confirm here:',
        confirmUrl(opts.alerts.siteUrl, row),
        '',
        'The link works for 7 days. If you didn’t ask for this, ignore this email: you won’t',
        'hear from us again, and we’ll delete your address within 7 days.',
        '',
        '— CivicScope, a nonpartisan guide to who’s running and what they’ve done',
      ].join('\n'),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'follow_confirmation_failed',
        followId: row.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new CmsError('We couldn’t send the email just now. Please try again later.');
  }
}

function shortLabel(label: string): string {
  const head = label.split(': ')[0]!;
  return head.length > 60 ? `${head.slice(0, 57)}…` : head;
}

export type FollowLinkCheck =
  | { state: 'ok'; follow: typeof alertFollow.$inferSelect; path: string }
  | { state: 'expired' | 'invalid' };

/** Checks a confirmation link without changing anything (for the page that shows it). */
export async function checkConfirmLink(
  db: Db,
  id: number,
  token: string | null | undefined,
  now = new Date(),
): Promise<FollowLinkCheck> {
  if (!Number.isInteger(id) || id < 1) return { state: 'invalid' };
  const [row] = await db.select().from(alertFollow).where(eq(alertFollow.id, id));
  if (!row || !signatureMatches(sign(confirmMessage(row.id, row.requestedAt)), token)) {
    return { state: 'invalid' };
  }
  if (!row.confirmedAt && now.getTime() - row.requestedAt.getTime() > FOLLOW_LIMITS.confirmForMs) {
    return { state: 'expired' };
  }
  return { state: 'ok', follow: row, path: followPath(row.kind, row.targetKey) };
}

/**
 * Confirms a follow. From here on, only records added after this moment are emailed:
 * the follow starts with everything already on the site marked as seen.
 */
export async function confirmFollow(
  db: Db,
  id: number,
  token: string | null | undefined,
  now = new Date(),
): Promise<FollowLinkCheck> {
  const check = await checkConfirmLink(db, id, token, now);
  if (check.state !== 'ok' || check.follow.confirmedAt) return check;
  const marks = await currentMarks(db, check.follow);
  await db
    .update(alertFollow)
    .set({ confirmedAt: now, requestIp: null, ...marks })
    .where(eq(alertFollow.id, id));
  return { ...check, follow: { ...check.follow, confirmedAt: now, requestIp: null, ...marks } };
}

export type UnsubscribeCheck =
  | { state: 'invalid' }
  | { state: 'one'; email: string; follow: typeof alertFollow.$inferSelect; path: string }
  | { state: 'all'; email: string };

/** Checks an unsubscribe link without changing anything. */
export async function checkUnsubscribeLink(
  db: Db,
  link: UnsubscribeLink,
): Promise<UnsubscribeCheck> {
  if (link.e) {
    if (!/^[0-9a-f]{64}$/.test(link.e)) return { state: 'invalid' };
    const rows = await db
      .select({ email: alertFollow.email })
      .from(alertFollow)
      .where(sql`sha2(${alertFollow.email}, 256) = ${link.e}`)
      .limit(1);
    const email = rows[0]?.email;
    if (!email || !signatureMatches(sign(stopAllMessage(email)), link.t)) {
      return { state: 'invalid' };
    }
    return { state: 'all', email };
  }
  const id = Number(link.f);
  if (!Number.isInteger(id) || id < 1) return { state: 'invalid' };
  const [row] = await db.select().from(alertFollow).where(eq(alertFollow.id, id));
  if (!row || !signatureMatches(sign(unsubscribeMessage(row.id, row.email)), link.t)) {
    return { state: 'invalid' };
  }
  return { state: 'one', email: row.email, follow: row, path: followPath(row.kind, row.targetKey) };
}

/**
 * Deletes the follow, or every follow for the address (a stop-all link, or `all` on a
 * single follow's link). Returns how many follows were removed, or null when the link
 * isn't valid or was already used.
 */
export async function unsubscribeFollow(
  db: Db,
  link: UnsubscribeLink,
  { all = false } = {},
): Promise<{ removed: number } | null> {
  const check = await checkUnsubscribeLink(db, link);
  if (check.state === 'invalid') return null;
  const [res] = await db
    .delete(alertFollow)
    .where(
      check.state === 'all' || all
        ? eq(alertFollow.email, check.email)
        : eq(alertFollow.id, check.follow.id),
    );
  return { removed: res.affectedRows };
}

/** Deletes requests that were never confirmed. */
export async function purgeUnconfirmedFollows(db: Db, now = new Date()): Promise<number> {
  const [res] = await db
    .delete(alertFollow)
    .where(
      and(
        isNull(alertFollow.confirmedAt),
        lt(alertFollow.requestedAt, new Date(now.getTime() - FOLLOW_LIMITS.confirmForMs)),
      ),
    );
  return res.affectedRows;
}

// ---------------------------------------------------------------------------------
// What a follow has already seen

export interface FollowMarks {
  seenVoteId: number;
  seenSponsorshipId: number;
  seenAction: string | null;
  seenFilingEnd: string | null;
}

export interface GlobalMarks {
  maxVoteId: number;
  maxSponsorshipId: number;
}

export async function globalMarks(db: Db): Promise<GlobalMarks> {
  const [v] = await db.select({ n: max(rollCallVote.id) }).from(rollCallVote);
  const [s] = await db.select({ n: max(billSponsorship.id) }).from(billSponsorship);
  return { maxVoteId: v?.n ?? 0, maxSponsorshipId: s?.n ?? 0 };
}

/** A bill's latest action as one short string, to notice when it changes. */
export function actionMark(on: string | null, text: string | null): string | null {
  if (!on && !text) return null;
  const hash = createHash('sha256')
    .update(text ?? '')
    .digest('hex')
    .slice(0, 40);
  return `${on ?? '----------'}|${hash}`;
}

export async function billState(db: Db, key: string) {
  const parsed = parseBillKey(key);
  if (!parsed) return null;
  const [b] = await db
    .select({
      congress: bill.congress,
      billType: bill.billType,
      number: bill.number,
      latestActionOn: bill.latestActionOn,
      latestActionText: bill.latestActionText,
    })
    .from(bill)
    .where(
      and(
        eq(bill.congress, parsed.congress),
        eq(bill.billType, parsed.billType),
        eq(bill.number, parsed.number),
        shown(bill),
      ),
    );
  return b ?? null;
}

/** The latest FEC report period for the person who holds this Bioguide ID. */
export async function latestFiling(db: Db, bioguideId: string) {
  const people = await db
    .select({ personId: personIdentifier.personId })
    .from(personIdentifier)
    .where(and(eq(personIdentifier.scheme, 'bioguide'), eq(personIdentifier.value, bioguideId)));
  if (!people.length) return null;
  const fecIds = await db
    .select({ value: personIdentifier.value })
    .from(personIdentifier)
    .where(
      and(
        eq(personIdentifier.scheme, 'fec_candidate_id'),
        inArray(
          personIdentifier.personId,
          people.map((p) => p.personId),
        ),
      ),
    );
  if (!fecIds.length) return null;
  const rows = await db
    .select()
    .from(fecCandidateTotals)
    .where(
      and(
        inArray(
          fecCandidateTotals.candidateId,
          fecIds.map((f) => f.value),
        ),
        isNotNull(fecCandidateTotals.coverageEnd),
      ),
    );
  return rows.sort((a, b) => (b.coverageEnd ?? '').localeCompare(a.coverageEnd ?? ''))[0] ?? null;
}

async function currentMarks(
  db: Db,
  follow: { kind: FollowKind; targetKey: string },
): Promise<FollowMarks> {
  const g = await globalMarks(db);
  const marks: FollowMarks = {
    seenVoteId: g.maxVoteId,
    seenSponsorshipId: g.maxSponsorshipId,
    seenAction: null,
    seenFilingEnd: null,
  };
  if (follow.kind === 'bill') {
    const b = await billState(db, follow.targetKey);
    marks.seenAction = b ? actionMark(b.latestActionOn, b.latestActionText) : null;
  } else {
    marks.seenFilingEnd = (await latestFiling(db, follow.targetKey))?.coverageEnd ?? null;
  }
  return marks;
}
