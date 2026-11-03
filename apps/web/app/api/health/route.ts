import { pingDatabase } from '@civicscope/cms';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Load balancer health check: 200 when the app can reach the database, 503 when it
 * can't. Says nothing else, so it reveals nothing about the setup.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  try {
    await pingDatabase(getDb());
    return new Response('{"status":"ok"}', { headers });
  } catch {
    return new Response('{"status":"unavailable"}', { status: 503, headers });
  }
}
