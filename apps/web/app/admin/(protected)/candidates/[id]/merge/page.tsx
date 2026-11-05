import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  describeOfficeholder,
  getPerson,
  identifierOwner,
  NotFoundError,
  previewPersonMerge,
  type MergeSide,
} from '@civicscope/cms';
import { can } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { ActionButton } from '@/components/admin/form';
import { getDb } from '@/lib/db';
import { IDENTIFIER_SCHEME_LABELS } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { linkOfficeholderAction, mergePeopleAction } from '../../../cms-actions';

export const metadata: Metadata = { title: 'Link or merge · CivicScope admin' };

type Search = { bioguide?: string; openstates?: string; person?: string; keep?: string };

/**
 * The preview before joining a candidate up with a politician record: either linking
 * (the officeholder has no CivicScope person yet) or merging two people. Nothing is
 * saved until the button at the bottom is pressed.
 */
export default async function JoinUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const user = await requirePermission('content:edit');
  const id = Number((await params).id);
  const q = await searchParams;
  const db = getDb();
  const current = await getPerson(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const back = (
    <p>
      <Link href={`/admin/candidates/${id}`}>← {current.fullName}</Link>
    </p>
  );

  const scheme = q.bioguide ? 'bioguide' : q.openstates ? 'openstates' : null;
  const value = q.bioguide ?? q.openstates ?? null;
  let otherId = q.person ? Number(q.person) : null;
  let office: Awaited<ReturnType<typeof describeOfficeholder>> = null;

  if (scheme && value) {
    office = await describeOfficeholder(db, scheme, value);
    const owner = await identifierOwner(db, scheme, value);
    if (owner?.id === id) {
      return (
        <>
          {back}
          <h1>Already linked</h1>
          <p>{current.fullName} already carries this politician&apos;s ID.</p>
        </>
      );
    }
    if (!owner) {
      return (
        <>
          {back}
          <h1>Link to a politician record</h1>
          <OfficeholderCard scheme={scheme} value={value} office={office} />
          <h2>What will happen</h2>
          <ul>
            <li>
              {current.fullName} gets the {IDENTIFIER_SCHEME_LABELS[scheme]} <code>{value}</code>.
              Nothing else on their record changes.
            </li>
            <li>
              {scheme === 'bioguide'
                ? 'Their bills, votes and campaign money imported from Congress.gov and the FEC show on their profile.'
                : 'Their state votes imported from Open States show on their profile.'}
            </li>
            <li>
              {current.publishState === 'published'
                ? 'The politician page links to their full profile.'
                : 'Once their profile is published, the politician page links to it.'}
            </li>
            <li>The change is recorded in the history and can be undone by removing the ID.</li>
          </ul>
          <ActionButton
            action={linkOfficeholderAction.bind(null, id, scheme, value)}
            label={`Link ${current.fullName} to this record`}
            variant="primary"
          />
        </>
      );
    }
    otherId = owner.id;
  }

  if (!otherId || !Number.isInteger(otherId)) notFound();

  const keepOther = q.keep === String(otherId);
  const keepId = keepOther ? otherId : id;
  const mergeId = keepOther ? id : otherId;
  const preview = await previewPersonMerge(db, keepId, mergeId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const swap = new URLSearchParams(
    Object.entries({ ...q, keep: keepOther ? '' : String(otherId) }).filter(([, v]) => v) as [
      string,
      string,
    ][],
  );
  const canMerge = can(user.role, 'content:archive');

  return (
    <>
      {back}
      <h1>Merge two records</h1>
      {scheme && value && (
        <>
          <p>
            The politician record you chose already belongs to another CivicScope person, most
            likely created by an import. Merge the two so this person has one profile.
          </p>
          <OfficeholderCard scheme={scheme} value={value} office={office} />
        </>
      )}

      <div className="merge-sides">
        <SideCard side={preview.keep} title="Kept" />
        <SideCard side={preview.merge} title="Merged in, then archived" />
      </div>
      <p>
        <Link href={`?${swap.toString()}`}>
          Keep “{preview.merge.fullName}” (#{preview.merge.id}) instead
        </Link>
      </p>

      {preview.problems.length > 0 && (
        <div className="alert" role="alert">
          <p>
            <strong>This merge can&apos;t go ahead yet:</strong>
          </p>
          <ul>
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.warnings.length > 0 && (
        <div className="notice">
          <p>
            <strong>Check before merging:</strong>
          </p>
          <ul>
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <h2>What will happen</h2>
      <ul>
        <li>
          Moved to “{preview.keep.fullName}”: {plural(preview.merge.identifiers.length, 'ID')},{' '}
          {plural(preview.merge.candidacies.length, 'candidacy', 'candidacies')},{' '}
          {plural(preview.merge.claims, 'profile entry', 'profile entries')},{' '}
          {plural(preview.merge.citations, 'source')} and {plural(preview.merge.photos, 'photo')}.
          Each move is recorded in the history.
        </li>
        {preview.result.filledIn.length > 0 && (
          <li>
            Blank fields filled in from the merged record: {preview.result.filledIn.join(', ')}.
          </li>
        )}
        <li>
          The kept record will be <strong>{preview.result.publishState}</strong>, at{' '}
          <code>/candidates/{preview.result.slug}</code>.
        </li>
        <li>
          “{preview.merge.fullName}” (#{preview.merge.id}) is archived, not deleted. Its history
          stays, and its old page <code>/candidates/{preview.merge.slug}</code> redirects to the
          kept one.
        </li>
        <li>
          Politician pages, votes, bills and campaign money follow the IDs, so they now point at the
          kept record.
        </li>
      </ul>
      {canMerge ? (
        preview.problems.length === 0 && (
          <ActionButton
            action={mergePeopleAction.bind(null, preview.keep.id, preview.merge.id)}
            label="Merge records"
            variant="primary"
            confirm={`Merge “${preview.merge.fullName}” into “${preview.keep.fullName}”? The merged record is archived.`}
          />
        )
      ) : (
        <p className="notice">Only owners and reviewers can merge records. Ask one to do it.</p>
      )}
    </>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function OfficeholderCard({
  scheme,
  value,
  office,
}: {
  scheme: 'bioguide' | 'openstates';
  value: string;
  office: { name: string; detail: string; publicPath: string } | null;
}) {
  return (
    <div className="admin-card">
      {office ? (
        <>
          <p>
            <strong>{office.name}</strong>
            <br />
            <span className="muted">{office.detail}</span>
          </p>
          <p className="small">
            {IDENTIFIER_SCHEME_LABELS[scheme]} <code>{value}</code> ·{' '}
            <Link href={office.publicPath}>politician page</Link>
          </p>
        </>
      ) : (
        <p>
          No imported record has {IDENTIFIER_SCHEME_LABELS[scheme]} <code>{value}</code>.
        </p>
      )}
    </div>
  );
}

function SideCard({ side, title }: { side: MergeSide; title: string }) {
  return (
    <section className="admin-card merge-side" aria-label={`${title}: ${side.fullName}`}>
      <p className="muted small">{title}</p>
      <h2>
        <Link href={`/admin/candidates/${side.id}`}>{side.fullName}</Link>{' '}
        <PublishBadge state={side.publishState} />
      </h2>
      <dl>
        <dt>Record</dt>
        <dd>
          #{side.id} · <code>/candidates/{side.slug}</code>
        </dd>
        {side.preferredName && (
          <>
            <dt>Preferred name</dt>
            <dd>{side.preferredName}</dd>
          </>
        )}
        <dt>Birth year</dt>
        <dd>{side.birthYear ?? '—'}</dd>
        <dt>IDs</dt>
        <dd>
          {side.identifiers.length === 0
            ? 'None'
            : side.identifiers.map((i) => (
                <span key={`${i.scheme}:${i.value}`} className="block">
                  {IDENTIFIER_SCHEME_LABELS[i.scheme]}: <code>{i.value}</code>
                </span>
              ))}
        </dd>
        <dt>Candidacies</dt>
        <dd>
          {side.candidacies.length === 0
            ? 'None'
            : side.candidacies.map((c) => (
                <span key={c.id} className="block">
                  {c.raceName} <span className="muted">({c.electionName})</span>
                </span>
              ))}
        </dd>
        <dt>Profile entries</dt>
        <dd>{side.claims}</dd>
        <dt>Sources</dt>
        <dd>{side.citations}</dd>
        <dt>Photos</dt>
        <dd>{side.photos}</dd>
      </dl>
    </section>
  );
}
