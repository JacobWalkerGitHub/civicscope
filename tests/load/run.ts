/**
 * A small load test for the public site, with no extra dependencies.
 *   pnpm test:load --url https://staging.example.org [--duration 60] [--concurrency 25]
 *                  [--p95 800] [--max-errors 0.01]
 * Each worker requests public pages in turn (home, directory, calendar, issues, search
 * and the race and candidate pages linked from the home page) as fast as it can. It
 * prints throughput and latency percentiles and exits with an error if p95 latency or
 * the error rate goes over the limits. Never point it at a site you don't run.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    duration: { type: 'string', default: '30' },
    concurrency: { type: 'string', default: '20' },
    p95: { type: 'string', default: '800' },
    'max-errors': { type: 'string', default: '0.01' },
  },
});
if (!values.url) {
  console.error('Give the site to test: pnpm test:load --url http://localhost:3000');
  process.exit(2);
}
const base = new URL(values.url);
const durationMs = Number(values.duration) * 1000;
const concurrency = Number(values.concurrency);
const p95Limit = Number(values.p95);
const maxErrorRate = Number(values['max-errors']);

async function discoverPaths(): Promise<string[]> {
  const paths = [
    '/',
    '/politicians',
    '/politicians/candidates',
    '/bills',
    '/bills?tab=progress',
    '/elections',
    '/issues',
    '/search?q=governor',
    '/search?q=kentucky',
    '/methodology',
  ];
  const home = await (await fetch(new URL('/', base))).text();
  const linked = [...home.matchAll(/href="(\/(?:races|candidates|elections)\/[^"?#]+)"/g)].map(
    (m) => m[1]!,
  );
  for (const p of [...new Set(linked)].slice(0, 10)) {
    paths.push(p);
    if (p.startsWith('/races/')) paths.push(`${p}/compare`);
  }
  return paths;
}

const paths = await discoverPaths();
console.log(
  `Load test: ${base.origin}, ${concurrency} workers for ${durationMs / 1000}s over ${paths.length} pages.`,
);

const latencies: number[] = [];
const errors = new Map<string, number>();
const deadline = Date.now() + durationMs;

async function worker(offset: number) {
  let i = offset;
  while (Date.now() < deadline) {
    const path = paths[i++ % paths.length]!;
    const started = performance.now();
    try {
      const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
      await res.arrayBuffer();
      if (!res.ok)
        errors.set(`${res.status} ${path}`, (errors.get(`${res.status} ${path}`) ?? 0) + 1);
    } catch (error) {
      const key = `${error instanceof Error ? error.name : 'error'} ${path}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
    latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, n) => worker(n)));

latencies.sort((a, b) => a - b);
const pct = (p: number) =>
  Math.round(
    latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0,
  );
const errorCount = [...errors.values()].reduce((a, b) => a + b, 0);
const errorRate = latencies.length ? errorCount / latencies.length : 1;
console.log(
  `${latencies.length} requests, ${(latencies.length / (durationMs / 1000)).toFixed(1)}/s. ` +
    `Latency ms: p50 ${pct(50)}, p95 ${pct(95)}, p99 ${pct(99)}, max ${pct(100)}. ` +
    `Errors: ${errorCount} (${(errorRate * 100).toFixed(2)}%).`,
);
for (const [key, n] of errors) console.log(`  ${n} × ${key}`);
const failed: string[] = [];
if (pct(95) > p95Limit) failed.push(`p95 ${pct(95)} ms is over ${p95Limit} ms`);
if (errorRate > maxErrorRate) failed.push(`error rate is over ${maxErrorRate * 100}%`);
if (failed.length) {
  console.error(`Load test FAILED: ${failed.join('; ')}.`);
  process.exitCode = 1;
} else {
  console.log('Load test passed.');
}
