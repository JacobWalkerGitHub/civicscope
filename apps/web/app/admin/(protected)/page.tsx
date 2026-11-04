import type { Metadata } from 'next';
import Link from 'next/link';
import {
  adminOverview,
  countOpenConflicts,
  countOpenCorrections,
  countReviewQueue,
} from '@civicscope/cms';
import { can, ROLE_DESCRIPTIONS } from '@civicscope/core';
import { PublishBadge } from '@/components/admin/badges';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';
import { requirePermission } from '@/lib/session';

export const metadata: Metadata = { title: 'Dashboard · CivicScope admin' };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export default async function DashboardPage() {
  const user = await requirePermission('admin:view');
  const db = getDb();
  const [overview, entries, conflicts, corrections] = await Promise.all([
    adminOverview(db),
    countReviewQueue(db),
    countOpenConflicts(db),
    countOpenCorrections(db),
  ]);
  const { counts, upcoming } = overview;
  const editor = can(user.role, 'content:edit');
  const attention = [
    { n: entries, label: 'profile entries waiting for review', href: '/admin/review' },
    { n: conflicts, label: 'import conflicts to resolve', href: '/admin/review' },
    ...(editor
      ? [{ n: corrections, label: 'correction requests from readers', href: '/admin/corrections' }]
      : []),
    { n: counts.drafts, label: 'candidates still in draft', href: '/admin/candidates' },
  ].filter((a) => a.n > 0);

  return (
    <>
      <header className="admin-page-head">
        <div>
          <p className="admin-eyebrow">Welcome back, {user.name.split(' ')[0]}</p>
          <h1>Dashboard</h1>
          <p className="muted">
            Signed in as <strong>{user.email}</strong> ({user.role}): {ROLE_DESCRIPTIONS[user.role]}
          </p>
        </div>
      </header>

      {editor && (
        <section aria-labelledby="quick-h" className="admin-section">
          <h2 id="quick-h">Start something</h2>
          <div className="quick-grid">
            <Link href="/admin/elections/new" className="quick-card">
              <span className="quick-icon" aria-hidden="true">
                ＋
              </span>
              <strong>New election</strong>
              <span>Set the date, then add its races and candidates step by step.</span>
            </Link>
            <Link href="/admin/elections" className="quick-card">
              <span className="quick-icon" aria-hidden="true">
                ＋
              </span>
              <strong>Add candidates to a race</strong>
              <span>Pick an election, open a race, and add who is running.</span>
            </Link>
            <Link href="/admin/candidates/new" className="quick-card">
              <span className="quick-icon" aria-hidden="true">
                ＋
              </span>
              <strong>New person</strong>
              <span>Add someone’s profile before or after they run.</span>
            </Link>
            {can(user.role, 'data:import') && (
              <Link href="/admin/imports" className="quick-card">
                <span className="quick-icon" aria-hidden="true">
                  ↑
                </span>
                <strong>Import a CSV</strong>
                <span>Add many candidates at once from a spreadsheet.</span>
              </Link>
            )}
          </div>
        </section>
      )}

      <div className="admin-two-col">
        <section aria-labelledby="attn-h" className="admin-card">
          <h2 id="attn-h">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="muted">Nothing is waiting. Nice work.</p>
          ) : (
            <ul className="attention-list">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link href={a.href}>
                    <span className="attention-n">{a.n}</span> {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="stats-h" className="admin-card">
          <h2 id="stats-h">What’s in CivicScope</h2>
          <dl className="admin-stats">
            <div>
              <dt>Upcoming elections</dt>
              <dd>{counts.elections}</dd>
            </div>
            <div>
              <dt>Races</dt>
              <dd>{counts.races}</dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{counts.people}</dd>
            </div>
            <div>
              <dt>Candidacies</dt>
              <dd>{counts.candidacies}</dd>
            </div>
            <div>
              <dt>Bills</dt>
              <dd>{counts.bills}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="up-h" className="admin-section">
        <div className="admin-section-head">
          <h2 id="up-h">Upcoming elections</h2>
          <Link href="/admin/elections">All elections →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="admin-empty">
            No upcoming elections yet.{' '}
            {editor && <Link href="/admin/elections/new">Create the first one →</Link>}
          </p>
        ) : (
          <ul className="election-tiles">
            {upcoming.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/elections/${e.id}`} className="election-tile">
                  <span className="election-tile-top">
                    <span className="muted">{formatDate(e.date)}</span>
                    <PublishBadge state={e.publishState} />
                  </span>
                  <strong>{e.name}</strong>
                  <span className="muted">
                    {e.jurisdictionName} · {plural(e.raceCount, 'race')} ·{' '}
                    {plural(e.candidateCount, 'candidate')}
                  </span>
                  {e.raceCount === 0 && <span className="tile-next">Next: add races →</span>}
                  {e.raceCount > 0 && e.candidateCount === 0 && (
                    <span className="tile-next">Next: add candidates →</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="how-h" className="admin-card admin-howto">
        <h2 id="how-h">How publishing works</h2>
        <ol>
          <li>
            <strong>Draft.</strong> Everything you add starts as a draft that only admins can see.
          </li>
          <li>
            <strong>Cite.</strong> Add at least one source to each person and candidacy, so readers
            can check every fact.
          </li>
          <li>
            <strong>Publish.</strong> A reviewer publishes the election, its races and candidates in
            one click with “Publish with candidates”.
          </li>
        </ol>
      </section>
    </>
  );
}
