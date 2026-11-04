/**
 * Promises and record: official bills and votes that an editor sets next to a
 * candidate's campaign promise, so readers can read the promise and the record side by
 * side. CivicScope never scores a promise as kept or broken; each link carries only a
 * neutral note on what the record is, and goes through the same review as the promise.
 */
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import {
  billLabel,
  promiseLinkInputSchema,
  type BillType,
  type PromiseRecordType,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor, type Tx } from './changes';
import { reviewAfterEdit, type Claim } from './claims';
import { CmsError, NotFoundError } from './errors';
import { parseInput } from './parse';

const {
  claim,
  promiseRecordLink,
  personIdentifier,
  bill,
  billSponsorship,
  rollCallVote,
  votePosition,
  source,
  stateBill,
  stateVote,
  stateVotePosition,
} = schema;

export type PromiseRecordLink = typeof promiseRecordLink.$inferSelect;

/** How many of a person's most recent bills and votes the admin picker offers. */
const PICKER_LIMIT = 150;

export const isPromise = (c: Pick<Claim, 'kind' | 'positionType'>) =>
  c.kind === 'position' && c.positionType === 'campaign_promise';

async function recordIds(tx: Tx | Db, personId: number) {
  const rows = await tx
    .select({ scheme: personIdentifier.scheme, value: personIdentifier.value })
    .from(personIdentifier)
    .where(eq(personIdentifier.personId, personId));
  return {
    bioguide: rows.filter((r) => r.scheme === 'bioguide').map((r) => r.value),
    openstates: rows.filter((r) => r.scheme === 'openstates').map((r) => r.value),
  };
}

type Ids = Awaited<ReturnType<typeof recordIds>>;

/** One linked record, as readers and editors see it. */
export interface PromiseRecordView {
  linkId: number;
  claimId: number;
  note: string;
  recordType: PromiseRecordType;
  recordId: number;
  /** When the person acted: sponsored the bill, or cast the vote. */
  date: string | null;
  /** "H.R. 1234", or a state bill's own identifier. */
  label: string;
  title: string;
  /** What the person did: "Sponsor", "Cosponsor", "Yea", "no", ... */
  action: string;
  /** The vote's result or the bill's latest action. */
  outcome: string | null;
  /** A CivicScope page for the record, when there is one. */
  href: string | null;
  /** The official source. */
  sourceUrl: string | null;
}

const shownState = (t: { publishState: MySqlColumn }, publicOnly: boolean) =>
  publicOnly ? notInArray(t.publishState, ['unpublished', 'archived']) : undefined;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The details of records of one type that this person is on. Records the person is not
 * on, or that are hidden from the public, are left out.
 */
async function describe(
  db: Db | Tx,
  ids: Ids,
  type: PromiseRecordType,
  recordIdsWanted: number[] | null,
  { publicOnly = false, limit }: { publicOnly?: boolean; limit?: number } = {},
): Promise<Omit<PromiseRecordView, 'linkId' | 'claimId' | 'note'>[]> {
  if (recordIdsWanted && recordIdsWanted.length === 0) return [];
  if (type === 'bill') {
    if (!ids.bioguide.length) return [];
    const rows = await db
      .select({
        id: bill.id,
        congress: bill.congress,
        billType: bill.billType,
        number: bill.number,
        title: bill.title,
        latestActionText: bill.latestActionText,
        role: billSponsorship.role,
        sponsoredOn: billSponsorship.sponsoredOn,
        withdrawnOn: billSponsorship.withdrawnOn,
        sourceUrl: source.url,
      })
      .from(billSponsorship)
      .innerJoin(bill, eq(bill.id, billSponsorship.billId))
      .leftJoin(source, eq(source.id, bill.sourceId))
      .where(
        and(
          inArray(billSponsorship.bioguideId, ids.bioguide),
          recordIdsWanted ? inArray(bill.id, recordIdsWanted) : undefined,
          shownState(bill, publicOnly),
        ),
      )
      .orderBy(desc(billSponsorship.sponsoredOn), desc(bill.id))
      .limit(limit ?? 1000);
    return rows.map((b) => ({
      recordType: 'bill',
      recordId: b.id,
      date: b.sponsoredOn,
      label: billLabel(b.billType as BillType, b.number),
      title: b.title,
      action:
        (b.role === 'sponsor' ? 'Sponsor' : 'Cosponsor') +
        (b.withdrawnOn ? ` (withdrew ${b.withdrawnOn})` : ''),
      outcome: b.latestActionText,
      href: `/bills/${b.congress}/${b.billType}/${b.number}`,
      sourceUrl: b.sourceUrl,
    }));
  }
  if (type === 'vote') {
    if (!ids.bioguide.length) return [];
    const rows = await db
      .select({
        id: rollCallVote.id,
        chamber: rollCallVote.chamber,
        rollNumber: rollCallVote.rollNumber,
        votedAt: rollCallVote.votedAt,
        question: rollCallVote.question,
        result: rollCallVote.result,
        legislationType: rollCallVote.legislationType,
        legislationNumber: rollCallVote.legislationNumber,
        voteCast: votePosition.voteCast,
        sourceUrl: source.url,
      })
      .from(votePosition)
      .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
      .leftJoin(source, eq(source.id, rollCallVote.sourceId))
      .where(
        and(
          inArray(votePosition.bioguideId, ids.bioguide),
          recordIdsWanted ? inArray(rollCallVote.id, recordIdsWanted) : undefined,
          shownState(rollCallVote, publicOnly),
        ),
      )
      .orderBy(desc(rollCallVote.votedAt))
      .limit(limit ?? 1000);
    return rows.map((v) => {
      const chamber = v.chamber === 'senate' ? 'Senate' : 'House';
      const measure = v.legislationNumber
        ? `${v.legislationType ?? ''} ${v.legislationNumber}`.trim()
        : null;
      return {
        recordType: 'vote',
        recordId: v.id,
        date: isoDate(v.votedAt),
        label: `${chamber} roll call ${v.rollNumber}${measure ? ` (${measure})` : ''}`,
        title: v.question ?? 'Roll call vote',
        action: v.voteCast,
        outcome: v.result,
        href: null,
        sourceUrl:
          v.chamber === 'senate'
            ? v.sourceUrl
            : `https://clerk.house.gov/Votes/${v.votedAt.toLocaleString('en-US', {
                year: 'numeric',
                timeZone: 'America/New_York',
              })}${v.rollNumber}`,
      };
    });
  }
  if (!ids.openstates.length) return [];
  const rows = await db
    .select({
      id: stateVote.id,
      votedOn: stateVote.votedOn,
      motion: stateVote.motion,
      result: stateVote.result,
      option: stateVotePosition.option,
      sourceUrl: stateVote.sourceUrl,
      state: stateBill.state,
      identifier: stateBill.identifier,
      title: stateBill.title,
      openstatesUrl: stateBill.openstatesUrl,
    })
    .from(stateVotePosition)
    .innerJoin(stateVote, eq(stateVote.id, stateVotePosition.voteId))
    .innerJoin(stateBill, eq(stateBill.id, stateVote.billId))
    .where(
      and(
        inArray(stateVotePosition.osPersonId, ids.openstates),
        recordIdsWanted ? inArray(stateVote.id, recordIdsWanted) : undefined,
      ),
    )
    .orderBy(desc(stateVote.votedOn), desc(stateVote.id))
    .limit(limit ?? 1000);
  return rows.map((v) => ({
    recordType: 'state_vote',
    recordId: v.id,
    date: v.votedOn,
    label: `${v.state} ${v.identifier}`,
    title: `${v.motion}: ${v.title}`,
    action: v.option,
    outcome: v.result,
    href: null,
    sourceUrl: v.sourceUrl ?? v.openstatesUrl,
  }));
}

/** The person's most recent bills and votes, for the admin picker. */
export async function listPromiseRecordOptions(db: Db, personId: number) {
  const ids = await recordIds(db, personId);
  const [bills, votes, stateVotes] = await Promise.all(
    (['bill', 'vote', 'state_vote'] as const).map((t) =>
      describe(db, ids, t, null, { limit: PICKER_LIMIT }),
    ),
  );
  return { bills: bills!, votes: votes!, stateVotes: stateVotes! };
}

/**
 * Linked records for these promises, keyed by claim id. With `publicOnly`, records hidden
 * from the public site are left out.
 */
export async function promiseRecordsFor(
  db: Db | Tx,
  personId: number,
  claimIds: number[],
  { publicOnly = false }: { publicOnly?: boolean } = {},
): Promise<Map<number, PromiseRecordView[]>> {
  const out = new Map<number, PromiseRecordView[]>();
  if (!claimIds.length) return out;
  const links = await db
    .select()
    .from(promiseRecordLink)
    .where(inArray(promiseRecordLink.claimId, claimIds));
  if (!links.length) return out;
  const ids = await recordIds(db, personId);
  const details = new Map<string, Omit<PromiseRecordView, 'linkId' | 'claimId' | 'note'>>();
  for (const type of ['bill', 'vote', 'state_vote'] as const) {
    const wanted = links.filter((l) => l.recordType === type).map((l) => l.recordId);
    for (const d of await describe(db, ids, type, wanted, { publicOnly })) {
      details.set(`${type}:${d.recordId}`, d);
    }
  }
  for (const l of links) {
    const d = details.get(`${l.recordType}:${l.recordId}`);
    if (!d) continue;
    out.set(l.claimId, [
      ...(out.get(l.claimId) ?? []),
      { ...d, linkId: l.id, claimId: l.claimId, note: l.note },
    ]);
  }
  // Oldest action first, so the record reads as a timeline after the promise.
  for (const list of out.values()) {
    list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.linkId - b.linkId);
  }
  return out;
}

async function loadPromise(tx: Tx, claimId: number): Promise<Claim> {
  const [c] = await tx.select().from(claim).where(eq(claim.id, claimId)).for('update');
  if (!c) throw new NotFoundError('Profile entry');
  if (!isPromise(c)) throw new CmsError('Only campaign promises can have records linked.');
  if (c.deletedAt) throw new CmsError('Restore this entry first.');
  return c;
}

/** Applies the promise's review rules after its linked records change, and logs it. */
async function afterLinkChange(tx: Tx, actor: Actor, before: Claim, what: string) {
  const { review, note } = await reviewAfterEdit(tx, actor, before);
  await tx.update(claim).set(review).where(eq(claim.id, before.id));
  const [after] = await tx.select().from(claim).where(eq(claim.id, before.id));
  await recordChange(tx, actor, {
    entityType: 'claim',
    entityId: before.id,
    action: 'update',
    before,
    after: after!,
    note: note ? `${what}. ${note}` : what,
  });
}

/** Sets an official record next to a campaign promise. The person must be on the record. */
export async function addPromiseLink(
  db: Db,
  actor: Actor,
  claimId: number,
  input: unknown,
): Promise<number> {
  const data = parseInput(promiseLinkInputSchema, input);
  return db.transaction(async (tx) => {
    const before = await loadPromise(tx, claimId);
    const ids = await recordIds(tx, before.personId);
    const [record] = await describe(tx, ids, data.record.type, [data.record.id]);
    if (!record) {
      throw new CmsError('That record isn’t one of this person’s bills or votes.', {
        record: 'Choose one of their bills or votes.',
      });
    }
    const [dupe] = await tx
      .select({ id: promiseRecordLink.id })
      .from(promiseRecordLink)
      .where(
        and(
          eq(promiseRecordLink.claimId, claimId),
          eq(promiseRecordLink.recordType, data.record.type),
          eq(promiseRecordLink.recordId, data.record.id),
        ),
      );
    if (dupe) throw new CmsError('That record is already linked to this promise.');
    const [res] = await tx.insert(promiseRecordLink).values({
      claimId,
      recordType: data.record.type,
      recordId: data.record.id,
      note: data.note,
      createdBy: actor.userId,
    });
    const [link] = await tx
      .select()
      .from(promiseRecordLink)
      .where(eq(promiseRecordLink.id, res.insertId));
    await recordChange(tx, actor, {
      entityType: 'promise_record_link',
      entityId: res.insertId,
      action: 'create',
      before: null,
      after: link!,
    });
    await afterLinkChange(tx, actor, before, `Linked ${record.label}`);
    return res.insertId;
  });
}

export async function removePromiseLink(db: Db, actor: Actor, linkId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(promiseRecordLink)
      .where(eq(promiseRecordLink.id, linkId));
    if (!link) throw new NotFoundError('Linked record');
    const before = await loadPromise(tx, link.claimId);
    await tx.delete(promiseRecordLink).where(eq(promiseRecordLink.id, linkId));
    await recordChange(tx, actor, {
      entityType: 'promise_record_link',
      entityId: linkId,
      action: 'delete',
      before: link,
      after: { ...link, deleted: true },
    });
    await afterLinkChange(tx, actor, before, 'Removed a linked record');
  });
}
