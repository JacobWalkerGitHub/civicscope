import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicComparison } from '@civicscope/cms';
import { ComparisonTable } from '@/components/public/compare';
import { getDb } from '@/lib/db';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const raceId = (raw: string) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** `?c=1&c=2`: candidacy IDs. Anything not a positive whole number is ignored. */
const candidacyIds = (v: string | string[] | undefined) =>
  [v ?? []]
    .flat()
    .filter((x) => /^\d{1,9}$/.test(x))
    .map(Number)
    .slice(0, 20);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = raceId((await params).id);
  const data = id ? await getPublicComparison(getDb(), id) : null;
  if (!data) return { title: 'Not found · CivicScope' };
  return {
    title: `Compare candidates · ${data.race.name} · CivicScope`,
    description: `Candidates in ${data.race.name}, ${data.race.electionName}, side by side with sources.`,
  };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const id = raceId((await params).id);
  if (!id) notFound();
  const data = await getPublicComparison(getDb(), id, candidacyIds((await searchParams).c));
  if (!data) notFound();
  return (
    <ComparisonTable
      data={data}
      candidateHref={(slug) => `/candidates/${slug}`}
      formAction={`/races/${id}/compare`}
    />
  );
}
