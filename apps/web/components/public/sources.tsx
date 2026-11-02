import type { PublicCitation } from '@civicscope/cms';
import type { SourceType } from '@civicscope/core';
import { formatDate, SOURCE_TYPE_LABELS } from '@/lib/labels';

/** The sources behind one fact or entry. Every public fact shows at least one. */
export function Sources({
  cites,
  label = 'Sources',
}: {
  cites?: PublicCitation[];
  label?: string;
}) {
  if (!cites || cites.length === 0) return null;
  return (
    <details className="sources">
      <summary>
        {label} ({cites.length})
      </summary>
      <ul>
        {cites.map((c, i) => (
          <li key={`${c.url}-${i}`}>
            <a href={c.url} rel="noopener noreferrer nofollow" target="_blank">
              {c.title}
            </a>
            <span className="muted">
              {' '}
              · {c.publisher} · {SOURCE_TYPE_LABELS[c.sourceType as SourceType] ?? c.sourceType}
              {c.publishedAt && <> · published {formatDate(c.publishedAt)}</>} · checked{' '}
              {formatDate(c.retrievedAt)}
            </span>
            {c.excerpt && <blockquote>{c.excerpt}</blockquote>}
            {c.locator && <span className="muted"> ({c.locator})</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Shown on every preview page so drafts are never mistaken for the public site. */
export function PreviewBanner({ adminHref }: { adminHref: string }) {
  return (
    <p className="preview-banner" role="note">
      <strong>Preview.</strong> This page includes drafts and unpublished records that the public
      can’t see. Items not yet public are marked. <a href={adminHref}>Back to the admin</a>
    </p>
  );
}

export function NotPublic({ state }: { state: string }) {
  if (state === 'published') return null;
  return <span className="badge badge-not-public">Not public ({state})</span>;
}
