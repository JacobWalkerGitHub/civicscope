import { and, eq, gte, lt, or } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';

const { ingestRun } = schema;

/*
 * Alerts for failed or stuck ingest runs. Two routes, so they work on any host:
 *
 * 1. Every alert is written to stderr as one JSON line with `"event":"civicscope_alert"`.
 *    A log-based alarm (a CloudWatch metric filter, a Vercel log drain, ...) matches it.
 * 2. If ALERT_WEBHOOK_URL is set (https only), the alert is also POSTed there as
 *    `{"text": "..."}`, the shape Slack, Discord (via /slack) and most chat tools accept.
 *
 * Sending an alert never throws: a broken webhook must not hide the original failure.
 */

export interface Alert {
  /** Short and specific: "FEC 2028 import failed". */
  title: string;
  detail?: string;
  source?: string;
  runId?: number;
}

export interface AlertOptions {
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export async function sendAlert(alert: Alert, opts: AlertOptions = {}): Promise<void> {
  const log = opts.log ?? ((line: string) => console.error(line));
  log(
    JSON.stringify({
      level: 'error',
      event: 'civicscope_alert',
      at: new Date().toISOString(),
      ...alert,
    }),
  );
  const url = opts.webhookUrl === undefined ? process.env.ALERT_WEBHOOK_URL : opts.webhookUrl;
  if (!url) return;
  if (!url.startsWith('https://')) {
    log(JSON.stringify({ level: 'warn', event: 'alert_webhook_skipped', reason: 'not https' }));
    return;
  }
  const text = [
    `CivicScope: ${alert.title}`,
    alert.detail,
    alert.runId ? `Run ${alert.runId}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log(JSON.stringify({ level: 'warn', event: 'alert_webhook_failed', status: res.status }));
    }
  } catch (error) {
    log(
      JSON.stringify({
        level: 'warn',
        event: 'alert_webhook_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Runs an ingest command and raises an alert if it throws, then rethrows so the
 * command still exits with an error.
 */
export async function alertOnFailure<T>(
  title: string,
  main: () => Promise<T>,
  opts: AlertOptions = {},
): Promise<T> {
  try {
    return await main();
  } catch (error) {
    await sendAlert(
      {
        title,
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      },
      opts,
    );
    throw error;
  }
}

export interface IngestProblem {
  kind: 'failed' | 'stuck';
  runId: number;
  source: string;
  startedAt: Date;
  error: string | null;
}

/**
 * Runs that failed since `since`, and runs still "running" after `stuckAfterHours`
 * (the process was killed, or the machine slept). Run it on a schedule a little more
 * often than the ingests themselves, e.g. hourly with `since` = two hours ago.
 */
export async function findIngestProblems(
  db: Db,
  {
    since,
    now = new Date(),
    stuckAfterHours = 6,
  }: { since: Date; now?: Date; stuckAfterHours?: number },
): Promise<IngestProblem[]> {
  const stuckBefore = new Date(now.getTime() - stuckAfterHours * 3_600_000);
  const rows = await db
    .select({
      runId: ingestRun.id,
      source: ingestRun.source,
      state: ingestRun.state,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      error: ingestRun.error,
    })
    .from(ingestRun)
    .where(
      or(
        and(eq(ingestRun.state, 'failed'), gte(ingestRun.finishedAt, since)),
        and(eq(ingestRun.state, 'running'), lt(ingestRun.startedAt, stuckBefore)),
      ),
    )
    .orderBy(ingestRun.id);
  return rows.map((r) => ({
    kind: r.state === 'failed' ? 'failed' : 'stuck',
    runId: r.runId,
    source: r.source,
    startedAt: r.startedAt,
    error: r.error,
  }));
}
