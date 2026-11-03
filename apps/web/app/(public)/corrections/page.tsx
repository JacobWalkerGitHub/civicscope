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

      <section aria-labelledby="policy-heading" className="prose">
        <h2 id="policy-heading">Our correction policy</h2>
        <dl className="definitions">
          <div>
            <dt>What you can report</dt>
            <dd>
              A wrong or outdated fact, a broken or wrong source link, a candidate listed in the
              wrong race or with the wrong status, or anything that reads as one-sided.
            </dd>
          </div>
          <div>
            <dt>How we check</dt>
            <dd>
              An editor compares the page with its sources and with any source you send. We change a
              fact only when a source supports the change. A request on its own is not enough.
            </dd>
          </div>
          <div>
            <dt>How fast</dt>
            <dd>
              We aim to review every request within three business days. In the four weeks before an
              election, we aim for one business day.
            </dd>
          </div>
          <div>
            <dt>What we publish</dt>
            <dd>
              Meaningful corrections go in the log below with the date and what changed. We fix
              typos and formatting without a log entry. We don’t quietly delete a correction.
            </dd>
          </div>
          <div>
            <dt>When sources disagree</dt>
            <dd>
              If reliable sources conflict, we mark the entry “Disputed” and show both, rather than
              pick a side.
            </dd>
          </div>
          <div>
            <dt>Candidates and campaigns</dt>
            <dd>
              Candidates and campaigns use this same form and the same standard. We don’t remove
              sourced information because a candidate disagrees with it. If they have a sourced
              response, we can add it. Nobody can pay to change, add or remove anything.
            </dd>
          </div>
        </dl>
      </section>

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
