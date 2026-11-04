import Link from 'next/link';
import type { getPublicPerson, PromiseRecordView } from '@civicscope/cms';
import { formatDate } from '@/lib/labels';
import { Entry } from './profile';

type Profile = NonNullable<Awaited<ReturnType<typeof getPublicPerson>>>;
type Claim = Profile['claims'][number];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function RecordItem({ r }: { r: PromiseRecordView }) {
  const isBill = r.recordType === 'bill';
  return (
    <li>
      <p className="promise-record-title">
        {r.href ? <Link href={r.href}>{r.label}</Link> : <strong>{r.label}</strong>} {r.title}
      </p>
      <p className="promise-record-meta">
        {r.date && <>{formatDate(r.date)} · </>}
        {isBill ? 'Their role' : 'Their vote'}: <strong>{capital(r.action)}</strong>
        {r.outcome && (
          <>
            {' '}
            · {isBill ? 'Latest action' : 'Result'}: {r.outcome}
          </>
        )}
        {r.sourceUrl && (
          <>
            {' '}
            ·{' '}
            <a href={r.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
              Official record
            </a>
          </>
        )}
      </p>
      <p className="promise-note">
        <span className="muted">Editor’s note:</span> {r.note}
      </p>
    </li>
  );
}

/**
 * Campaign promises in the candidate's words, each beside the official bills and votes an
 * editor linked to it. Deliberately no kept/broken rating: readers weigh the two sides.
 */
export function PromisesAndRecord({ promises, profile }: { promises: Claim[]; profile: Profile }) {
  if (!promises.length) return null;
  return (
    <section aria-labelledby="promises-heading">
      <h2 id="promises-heading">Promises and record</h2>
      <p className="muted">
        Each campaign promise is shown in the candidate’s own words, next to official bills and
        votes that an editor linked to it and a reviewer checked. CivicScope doesn’t rate promises
        as kept or broken. Read both sides and decide for yourself.
      </p>
      <div className="promise-list">
        {promises.map((c) => {
          const record = profile.promiseRecords.get(c.id) ?? [];
          return (
            <div key={c.id} className="promise-pair">
              <div className="promise-said">
                <p className="promise-col-label">What they promised</p>
                <Entry c={c} profile={profile} />
              </div>
              <div className="promise-record">
                <p className="promise-col-label">What the record shows</p>
                {record.length ? (
                  <ul>
                    {record.map((r) => (
                      <RecordItem key={r.linkId} r={r} />
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No bills or votes are linked to this promise yet. That doesn’t mean there is no
                    record, only that none has been reviewed.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
