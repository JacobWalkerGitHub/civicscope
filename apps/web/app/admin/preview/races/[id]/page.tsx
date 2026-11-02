import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicRace } from '@civicscope/cms';
import { RaceOverview } from '@/components/public/race';
import { PreviewBanner } from '@/components/public/sources';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Preview · CivicScope admin' };

export default async function RacePreview({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('admin:view');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const page = await getPublicRace(getDb(), id, { preview: true });
  if (!page) notFound();
  return (
    <>
      <PreviewBanner adminHref={`/admin/races/${id}`} />
      <RaceOverview page={page} candidateHref={(slug) => `/admin/preview/candidates/${slug}`} />
    </>
  );
}
