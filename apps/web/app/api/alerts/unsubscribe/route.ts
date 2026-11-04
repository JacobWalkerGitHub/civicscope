import { unsubscribeFollow } from '@civicscope/cms';
import { getDb } from '@/lib/db';

/**
 * One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe
 * header of an alert email. The signed link is the authorization.
 */
export async function POST(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  await unsubscribeFollow(getDb(), { f: q.get('f'), e: q.get('e'), t: q.get('t') });
  // The same answer whether or not the link was still active.
  return new Response('Unsubscribed.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
