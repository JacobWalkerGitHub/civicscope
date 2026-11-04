import {
  char,
  date,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { FOLLOW_KINDS } from '@civicscope/core';

/*
 * Email alerts: a reader follows a Member of Congress or a bill and gets an email when
 * something new is recorded. Personal data is kept to the minimum the feature needs:
 * the email address and what it follows. The requester's IP address is kept only
 * until the follow is confirmed (to limit abuse of the form), and an unconfirmed
 * request is deleted after 7 days. Unsubscribing deletes the row. Links in emails are
 * signed (see packages/cms/src/follows.ts), so no tokens are stored.
 *
 * Not audited: the audit log is append-only and must never hold readers' addresses.
 */
export const alertFollow = mysqlTable(
  'alert_follow',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Lowercased. */
    email: varchar('email', { length: 254 }).notNull(),
    kind: mysqlEnum('kind', FOLLOW_KINDS).notNull(),
    /** A Bioguide ID ("A000360"), or a bill as "119-hr-1234". */
    targetKey: varchar('target_key', { length: 40 }).notNull(),
    /** The name or bill label when followed, for emails. */
    targetLabel: varchar('target_label', { length: 300 }).notNull(),
    /** When the confirmation email was (last) sent. Confirmation links are tied to it. */
    requestedAt: datetime('requested_at', { mode: 'date', fsp: 3 }).notNull(),
    requestIp: varchar('request_ip', { length: 45 }),
    confirmedAt: datetime('confirmed_at', { mode: 'date', fsp: 3 }),
    lastSentAt: datetime('last_sent_at', { mode: 'date', fsp: 3 }),
    /** What the last email (or the confirmation) already covered. */
    seenVoteId: int('seen_vote_id').notNull().default(0),
    seenSponsorshipId: int('seen_sponsorship_id').notNull().default(0),
    /** A bill's latest action, as "date|hash of text". */
    seenAction: char('seen_action', { length: 51 }),
    /** The end of the latest FEC report period seen for the member. */
    seenFilingEnd: date('seen_filing_end', { mode: 'string' }),
  },
  (t) => [
    uniqueIndex('alert_follow_uq').on(t.email, t.kind, t.targetKey),
    index('alert_follow_confirmed_idx').on(t.confirmedAt),
    index('alert_follow_requested_idx').on(t.requestedAt),
  ],
);
