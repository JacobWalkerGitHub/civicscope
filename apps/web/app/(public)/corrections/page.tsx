import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicCorrections } from '@civicscope/cms';
import { formatDate } from '@/lib/labels';
import { getDb } from '@/lib/db';
import { CorrectionForm } from './correction-form';

export const metadata: Metadata = {
  title: 'Corrections · CivicScope',
  description: 'Report a mistake on CivicScope, and see the corrections we have made.',
};

type Search = Record<string, string | string[] | undefined>;

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const raw = (await searchParams).page;
  const page = typeof raw === 'string' && /^\/(?!\/)\S{0,499}$/.test(raw) ? raw : null;
  const log = await listPublicCorrections(getDb());
  return (
    <>
      <h1>Corrections</h1>
      <p>
        If something on CivicScope is wrong or out of date, tell us. An editor checks every request
        against the sources. When we change something meaningful, we list it below with the date.
      </p>

      <section aria-labelledby="report-heading">
        <h2 id="report-heading">Report a mistake</h2>
        <CorrectionForm pagePath={page} />
      </section>

      <section aria-labelledby="log-heading">
        <h2 id="log-heading">Corrections log</h2>
        {log.length === 0 ? (
          <p className="muted">No corrections have been made yet.</p>
        ) : (
          <ul className="corrections-log">
            {log.map((c) => (
              <li key={c.id}>
                <time dateTime={c.resolvedAt!.toISOString()}>
                  {formatDate(c.resolvedAt!.toISOString().slice(0, 10))}
                </time>
                : {c.publicNote}
                {c.pagePath && (
                  <>
                    {' '}
                    <Link href={c.pagePath}>See the page</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
