import { can, type UserRole } from '@civicscope/core';
import { listAuditEntries, listRevisions } from '@civicscope/cms';
import { restoreVersionAction } from '@/app/admin/(protected)/cms-actions';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { ActionButton } from './form';

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  publish: 'Published',
  unpublish: 'Unpublished',
  archive: 'Archived',
  restore: 'Restored',
};

function describeDiff(diff: unknown): string {
  if (!diff || typeof diff !== 'object') return '';
  const fields = Object.keys(diff as Record<string, unknown>).filter(
    (k) => k !== 'id' && k !== 'deletedAt',
  );
  return fields.length ? `Changed: ${fields.join(', ')}` : '';
}

/** Change log and saved versions for one record, with restore buttons. */
export async function History({
  entityType,
  entityId,
  role,
}: {
  entityType: string;
  entityId: number;
  role: UserRole;
}) {
  const db = getDb();
  const [entries, revisions] = await Promise.all([
    listAuditEntries(db, entityType, entityId),
    listRevisions(db, entityType, entityId),
  ]);
  const canRestore = can(role, 'content:edit');
  const latest = revisions[0]?.version;
  const versionByIndex = new Map(revisions.map((r) => [r.version, r]));

  return (
    <section aria-labelledby="history-heading" className="history">
      <h2 id="history-heading">History</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const version = revisions.length - i;
            const rev = versionByIndex.get(version);
            return (
              <tr key={entry.id}>
                <td>{version}</td>
                <td>{dateTime.format(entry.occurredAt)}</td>
                <td>{entry.actorName ?? entry.actorId}</td>
                <td>
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.note ? ` (${entry.note})` : ''}
                  {entry.action === 'update' && (
                    <span className="muted"> {describeDiff(entry.diff)}</span>
                  )}
                </td>
                <td>
                  {canRestore && rev && version !== latest && (
                    <ActionButton
                      action={restoreVersionAction.bind(null, entityType, entityId, version)}
                      label={`Restore version ${version}`}
                      confirm={`Restore version ${version}? This saves it as a new version; nothing is lost.`}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
