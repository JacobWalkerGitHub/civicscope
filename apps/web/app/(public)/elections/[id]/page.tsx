import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicElection } from '@civicscope/cms';
import { ElectionOverview } from '@/components/public/election';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

// Reads the database on every request, so publishing in the admin shows up at once.
export const dynamic = 'force-dynamic';

const load = cache(async (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getPublicElection(getDb(), id);
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await load((await params).id);
  if (!page) return { title: 'Not found · CivicScope' };
  return {
    title: `${page.election.name} · CivicScope`,
    description: `Dates, deadlines and official resources for the ${page.election.name}.`,
  };
}

export default async function ElectionPage({ params }: Params) {
  const page = await load((await params).id);
  if (!page) notFound();
  return (
    <ElectionOverview
      page={page}
      raceHref={(id) => `/races/${id}`}
      electionHref={(id) => `/elections/${id}`}
    />
  );
}
