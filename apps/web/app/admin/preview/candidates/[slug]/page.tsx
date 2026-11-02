import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicPerson } from '@civicscope/cms';
import { CandidateProfile } from '@/components/public/profile';
import { PreviewBanner } from '@/components/public/sources';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Preview · CivicScope admin' };

export default async function CandidatePreview({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission('admin:view');
  const profile = await getPublicPerson(getDb(), (await params).slug, { preview: true });
  if (!profile) notFound();
  return (
    <>
      <PreviewBanner adminHref={`/admin/candidates/${profile.person.id}`} />
      <CandidateProfile profile={profile} raceHref={(id) => `/admin/preview/races/${id}`} />
    </>
  );
}
