import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import type { Tx } from './changes';
import { FEC_API_BASE } from './fec-import';
import { fetchText, withoutKey, type FetchOptions } from './ingest-common';

const { candidacy, fecCandidateTotals, ingestRun, ingestSnapshot, personIdentifier } = schema;

/*
 * Campaign money from the FEC: for every FEC candidate ID on a person who runs in a
 * CivicScope race, the FEC's totals for one two-year period (raised, spent, cash on hand,
 * debts), read 50 IDs to a request from /v1/candidates/totals/.
 */

export interface FecTotalsSummary {
  candidateIds: number;
  requests: number;
  stored: number;
  /** IDs the FEC has no totals for in this period (often: nothing filed yet). */
  missing: number;
}

export interface FecTotalsOptions extends FetchOptions {
  apiKey: string;
  baseUrl?: string;
  startedBy?: number | null;
}

interface FecTotalRow {
  candidate_id: string;
  cycle: number;
  receipts?: number | null;
  disbursements?: number | null;
  cash_on_hand_end_period?: number | null;
  debts_owed_by_committee?: number | null;
  coverage_start_date?: string | null;
  coverage_end_date?: string | null;
  load_date?: string | null;
}

const BATCH = 50;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

/** Reads and stores the FEC totals for one two-year period. */
export async function runFecTotalsImport(
  db: Db,
  cycle: number,
  opts: FecTotalsOptions,
): Promise<{ runId: number; summary: FecTotalsSummary }> {
  const [run] = await db.insert(ingestRun).values({
    source: 'fec_totals',
    params: { cycle },
    startedBy: opts.startedBy ?? null,
  });
  const runId = run.insertId;
  const summary: FecTotalsSummary = { candidateIds: 0, requests: 0, stored: 0, missing: 0 };
  try {
    const ids = [
      ...new Set(
        (
          await db
            .selectDistinct({ value: personIdentifier.value })
            .from(personIdentifier)
            .innerJoin(candidacy, eq(candidacy.personId, personIdentifier.personId))
            .where(eq(personIdentifier.scheme, 'fec_candidate_id'))
        ).map((r) => r.value.toUpperCase()),
      ),
    ]
      .filter((id) => /^[HSP][0-9A-Z]{8}$/.test(id))
      .sort();
    summary.candidateIds = ids.length;
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const url = new URL('/v1/candidates/totals/', opts.baseUrl ?? FEC_API_BASE);
      for (const id of batch) url.searchParams.append('candidate_id', id);
      url.searchParams.set('cycle', String(cycle));
      url.searchParams.set('election_full', 'false');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('api_key', opts.apiKey);
      const body = await fetchText(url, opts);
      summary.requests++;
      let rows: FecTotalRow[];
      try {
        const json = JSON.parse(body) as { results?: unknown };
        if (!Array.isArray(json.results)) throw new Error();
        rows = json.results as FecTotalRow[];
      } catch {
        throw new Error('The FEC totals response is not in the expected format.');
      }
      await db.insert(ingestSnapshot).values({ runId, url: withoutKey(url), body });
      for (const r of rows) {
        if (typeof r.candidate_id !== 'string' || Number(r.cycle) !== cycle) continue;
        const values = {
          candidateId: r.candidate_id,
          cycle,
          receipts: num(r.receipts),
          disbursements: num(r.disbursements),
          cashOnHand: num(r.cash_on_hand_end_period),
          debts: num(r.debts_owed_by_committee),
          coverageStart: day(r.coverage_start_date),
          coverageEnd: day(r.coverage_end_date),
          sourceUpdatedAt: typeof r.load_date === 'string' ? r.load_date.slice(0, 40) : null,
        };
        await db
          .insert(fecCandidateTotals)
          .values(values)
          .onDuplicateKeyUpdate({
            set: { ...values, candidateId: undefined, cycle: undefined },
          });
        found.add(r.candidate_id);
        summary.stored++;
      }
    }
    summary.missing = ids.filter((id) => !found.has(id)).length;
    await db
      .update(ingestRun)
      .set({ state: 'succeeded', finishedAt: new Date(), summary })
      .where(eq(ingestRun.id, runId));
    return { runId, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRun)
      .set({ state: 'failed', finishedAt: new Date(), summary, error: message.slice(0, 2000) })
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}

export interface FecTotalsView {
  candidateId: string;
  cycle: number;
  receipts: number | null;
  disbursements: number | null;
  cashOnHand: number | null;
  debts: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
}

/** The latest two-year totals for each of a person's FEC candidate IDs. */
export async function getFecTotals(db: Db | Tx, personId: number): Promise<FecTotalsView[]> {
  const ids = (
    await db
      .select({ value: personIdentifier.value })
      .from(personIdentifier)
      .where(
        and(
          eq(personIdentifier.personId, personId),
          eq(personIdentifier.scheme, 'fec_candidate_id'),
        ),
      )
  ).map((r) => r.value.toUpperCase());
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      candidateId: fecCandidateTotals.candidateId,
      cycle: fecCandidateTotals.cycle,
      receipts: fecCandidateTotals.receipts,
      disbursements: fecCandidateTotals.disbursements,
      cashOnHand: fecCandidateTotals.cashOnHand,
      debts: fecCandidateTotals.debts,
      coverageStart: fecCandidateTotals.coverageStart,
      coverageEnd: fecCandidateTotals.coverageEnd,
    })
    .from(fecCandidateTotals)
    .where(inArray(fecCandidateTotals.candidateId, ids))
    .orderBy(desc(fecCandidateTotals.cycle), fecCandidateTotals.candidateId);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.candidateId) && seen.add(r.candidateId));
}
