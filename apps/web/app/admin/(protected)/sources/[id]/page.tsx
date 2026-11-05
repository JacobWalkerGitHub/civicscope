import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSource, listCitationsOfSource, NotFoundError } from '@civicscope/cms';
import { can, sourceTier } from '@civicscope/core';
import { ActionButton } from '@/components/admin/form';
import { History } from '@/components/admin/history';
import { getDb } from '@/lib/db';
import { SOURCE_TYPE_LABELS, TIER_LABELS } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { archiveAction, updateSourceAction } from '../../cms-actions';
import { SourceForm } from '../source-form';
import { ExternalLink } from '@/components/external-link';

export const metadata: Metadata = { title: 'Source · CivicScope admin' };

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('admin:view');
  const id = Number((await params).id);
  const db = getDb();
  const source = await getSource(db, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const citations = await listCitationsOfSource(db, id);
  const archived = Boolean(source.deletedAt);

  return (
    <>
      <p>
        <Link href="/admin/sources">← Sources</Link>
      </p>
      <div className="page-header">
        <h1>{source.title}</h1>
        {can(user.role, 'content:archive') && (
          <ActionButton
            action={archiveAction.bind(null, 'source', id, !archived)}
            label={archived ? 'Restore' : 'Archive'}
            variant={archived ? 'secondary' : 'danger'}
            confirm={archived ? undefined : 'Archive this source?'}
          />
        )}
      </div>
      <p>
        <ExternalLink href={source.url} max={60} />
        <br />
        <span className="muted">
          {SOURCE_TYPE_LABELS[source.sourceType]} · {TIER_LABELS[sourceTier(source.sourceType)]}
        </span>
      </p>
      {archived && <p className="notice">This source is archived and can&apos;t be cited.</p>}
      {can(user.role, 'content:edit') && !archived && (
        <SourceForm action={updateSourceAction.bind(null, id)} source={source} />
      )}

      <section aria-labelledby="cited-heading">
        <h2 id="cited-heading">Cited for</h2>
        {citations.length === 0 ? (
          <p className="muted">Nothing cites this source right now.</p>
        ) : (
          <ul>
            {citations.map((c) => (
              <li key={c.id}>
                {c.subjectType === 'person' ? (
                  <Link href={`/admin/candidates/${c.subjectId}`}>{c.personName}</Link>
                ) : c.subjectType === 'claim' ? (
                  <Link href={`/admin/claims/${c.subjectId}`}>{c.claimTitle} (profile entry)</Link>
                ) : (
                  <Link href={`/admin/candidacies/${c.subjectId}`}>
                    {c.candidacyName} (candidacy)
                  </Link>
                )}
                {c.field && <span className="muted"> · {c.field}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <History entityType="source" entityId={id} role={user.role} />
    </>
  );
}
