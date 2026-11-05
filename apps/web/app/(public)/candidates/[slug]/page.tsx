import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { getPublicPerson, mergedProfileSlug } from '@civicscope/cms';
import { CandidateProfile } from '@/components/public/profile';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ slug: string }> };

// Only published records; drafts are seen through /admin/preview instead.
const load = cache((slug: string) => getPublicPerson(getDb(), slug));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const profile = await load((await params).slug);
  if (!profile) return { title: 'Not found · CivicScope' };
  return {
    title: `${profile.person.fullName} · CivicScope`,
    description: `Sourced candidacies, positions and biography for ${profile.person.fullName}.`,
  };
}

export default async function CandidatePage({ params }: Params) {
  const { slug } = await params;
  const profile = await load(slug);
  if (!profile) {
    // A record merged into another person: send old links to the profile that's kept.
    const target = await mergedProfileSlug(getDb(), slug);
    if (target) permanentRedirect(`/candidates/${target}`);
    notFound();
  }
  return <CandidateProfile profile={profile} raceHref={(id) => `/races/${id}`} />;
}
