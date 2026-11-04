import { redirect } from 'next/navigation';

type Search = Record<string, string | string[] | undefined>;

/** The candidate directory moved under Politicians; old links keep working. */
export default async function CandidatesRedirect({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const x of Array.isArray(v) ? v : v ? [v] : []) params.append(k, x);
  }
  const qs = params.toString();
  redirect(qs ? `/politicians/candidates?${qs}` : '/politicians/candidates');
}
