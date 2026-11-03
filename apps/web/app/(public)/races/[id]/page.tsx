import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicRace } from '@civicscope/cms';
import { RaceOverview } from '@/components/public/race';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

const load = cache(async (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getPublicRace(getDb(), id);
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await load((await params).id);
  if (!page) return { title: 'Not found · CivicScope' };
  return {
    title: `${page.race.name} · ${page.race.electionName} · CivicScope`,
    description: `Candidates in ${page.race.name}, ${page.race.electionName}, with sources.`,
  };
}

export default async function RacePage({ params }: Params) {
  const page = await load((await params).id);
  if (!page) notFound();
  return (
    <RaceOverview
      page={page}
      candidateHref={(slug) => `/candidates/${slug}`}
      electionHref={(id) => `/elections/${id}`}
      compareHref={(id) => `/races/${id}/compare`}
    />
  );
}
