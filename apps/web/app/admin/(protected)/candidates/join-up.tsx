import Link from 'next/link';
import { findLinkTargets, type LinkTarget } from '@civicscope/cms';
import { PublishBadge } from '@/components/admin/badges';
import { getDb } from '@/lib/db';

const KIND_LABELS: Record<LinkTarget['kind'], string> = {
  congress: 'Member of Congress',
  state: 'State official',
  person: 'CivicScope person',
};

function reviewHref(personId: number, t: LinkTarget): string {
  const base = `/admin/candidates/${personId}/merge`;
  if (t.kind === 'person') return `${base}?person=${t.linkedPerson!.id}`;
  return `${base}?${t.scheme}=${encodeURIComponent(t.value!)}`;
}

/**
 * On a person's page: find the politician (Member of Congress, governor or state
 * legislator) or duplicate person this record should be joined up with. Nothing changes
 * here; each result opens a preview first.
 */
export async function JoinUpPanel({
  personId,
  query,
  canEdit,
  mergedInto,
}: {
  personId: number;
  query: string;
  canEdit: boolean;
  mergedInto: number | null;
}) {
  if (mergedInto) {
    return (
      <section aria-labelledby="join-heading">
        <h2 id="join-heading">Merged</h2>
        <p className="notice">
          This record was merged into{' '}
          <Link href={`/admin/candidates/${mergedInto}`}>person {mergedInto}</Link>. Its history is
          kept below.
        </p>
      </section>
    );
  }
  if (!canEdit) return null;
  const targets = query ? await findLinkTargets(getDb(), personId, query) : [];
  return (
    <section aria-labelledby="join-heading">
      <h2 id="join-heading">Politician record and duplicates</h2>
      <p className="muted">
        If this candidate holds office now, link them to their politician record (imported from
        Congress.gov or Open States) so their votes and bills show on their profile. If the import
        already created a separate person for them, merge the two. You&apos;ll see exactly what
        changes before anything is saved.
      </p>
      <form className="filters" method="get" role="search" action={`#join-heading`}>
        <label>
          Name
          <input name="join" type="search" defaultValue={query} minLength={2} required />
        </label>
        <button type="submit" className="secondary">
          Find
        </button>
      </form>
      {query && targets.length === 0 && (
        <p className="muted">No politicians or people match “{query}”. Try the last name only.</p>
      )}
      {targets.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Record</th>
              <th scope="col">CivicScope person</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => {
              const self = t.linkedPerson?.id === personId;
              return (
                <tr key={`${t.kind}:${t.value ?? t.linkedPerson?.id}`}>
                  <td>{t.name}</td>
                  <td>
                    {KIND_LABELS[t.kind]}
                    <br />
                    <span className="muted small">{t.detail}</span>
                  </td>
                  <td>
                    {self ? (
                      'This person'
                    ) : t.linkedPerson ? (
                      <>
                        <Link href={`/admin/candidates/${t.linkedPerson.id}`}>
                          {t.linkedPerson.fullName}
                        </Link>{' '}
                        <PublishBadge state={t.linkedPerson.publishState} />
                      </>
                    ) : (
                      <span className="muted">None yet</span>
                    )}
                  </td>
                  <td>
                    {self ? (
                      <span className="muted">Already linked</span>
                    ) : (
                      <Link className="button" href={reviewHref(personId, t)}>
                        {t.linkedPerson ? 'Review merge' : 'Review link'}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
