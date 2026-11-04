import {
  char,
  date,
  decimal,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
  int,
} from 'drizzle-orm/mysql-core';
import { timestamps } from './columns';

/*
 * Campaign money as the FEC reports it: one candidate's totals for one two-year period,
 * summed by the FEC across the candidate's own (authorized) committees. Copied from the
 * FEC's /candidates/totals/ and replaced on each read; nothing here is edited by hand.
 * A total reaches a CivicScope person through person_identifier (scheme
 * 'fec_candidate_id').
 */
const money = (name: string) => decimal(name, { precision: 14, scale: 2, mode: 'number' });

export const fecCandidateTotals = mysqlTable(
  'fec_candidate_totals',
  {
    id: int('id').autoincrement().primaryKey(),
    candidateId: char('candidate_id', { length: 9 }).notNull(),
    /** The two-year period, named for its even year. */
    cycle: smallint('cycle').notNull(),
    receipts: money('receipts'),
    disbursements: money('disbursements'),
    cashOnHand: money('cash_on_hand'),
    debts: money('debts'),
    coverageStart: date('coverage_start', { mode: 'string' }),
    coverageEnd: date('coverage_end', { mode: 'string' }),
    /** The FEC's load_date for the row, as given. */
    sourceUpdatedAt: varchar('source_updated_at', { length: 40 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('fec_candidate_totals_uq').on(t.candidateId, t.cycle)],
);

/**
 * Independent expenditures: money a committee outside the campaign reported spending
 * to support or oppose a candidate in one two-year period, summed by the FEC per
 * committee from Schedule E filings. Replaced on each read.
 */
export const fecOutsideSpending = mysqlTable(
  'fec_outside_spending',
  {
    id: int('id').autoincrement().primaryKey(),
    candidateId: char('candidate_id', { length: 9 }).notNull(),
    cycle: smallint('cycle').notNull(),
    committeeId: char('committee_id', { length: 9 }).notNull(),
    committeeName: varchar('committee_name', { length: 200 }).notNull(),
    /** 'S' to support the candidate, 'O' to oppose. */
    supportOppose: char('support_oppose', { length: 1 }).notNull(),
    total: money('total').notNull(),
    /** How many expenditures make up the total. */
    count: int('count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('fec_outside_spending_uq').on(
      t.candidateId,
      t.cycle,
      t.committeeId,
      t.supportOppose,
    ),
  ],
);
