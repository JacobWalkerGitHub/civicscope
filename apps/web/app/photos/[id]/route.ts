import { getPhotoForServing } from '@civicscope/cms';
import { can } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

/**
 * Serves a candidate photo from CivicScope's own copy. The public gets only the
 * current photo of a published person; signed-in admins also see drafts' photos,
 * and those responses are never cached.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response('Not found', { status: 404 });
  const db = getDb();
  let photo = await getPhotoForServing(db, id);
  let cache = 'public, max-age=300, s-maxage=300';
  if (!photo) {
    const user = await getCurrentUser();
    if (user && can(user.role, 'admin:view')) {
      photo = await getPhotoForServing(db, id, { admin: true });
      cache = 'private, no-store';
    }
  }
  if (!photo) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.data.length),
      'Cache-Control': cache,
      ETag: `"${photo.sha256}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    },
  });
}
