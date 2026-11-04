import type { Metadata } from 'next';
import Link from 'next/link';
import { listStates } from '@civicscope/cms';
import { getDb } from '@/lib/db';
import { electionSteps, Steps } from '@/components/admin/steps';
import { requirePermission } from '@/lib/session';
import { createElectionAction } from '../../cms-actions';
import { ElectionForm } from '../election-form';

export const metadata: Metadata = { title: 'New election · CivicScope admin' };

export default async function NewElectionPage() {
  await requirePermission('content:edit');
  return (
    <>
      <p className="admin-crumbs">
        <Link href="/admin/elections">← Elections</Link>
      </p>
      <header className="admin-page-head">
        <div>
          <p className="admin-eyebrow">Step 1 of 4</p>
          <h1>New election</h1>
          <p className="muted">
            Start with the basics. Next you’ll add the races on the ballot, then the candidates in
            each race. Everything stays a draft until a reviewer publishes it.
          </p>
        </div>
      </header>
      <Steps steps={electionSteps({ races: 0, candidates: 0, published: false, at: 'election' })} />
      <div className="admin-card">
        <ElectionForm
          action={createElectionAction}
          states={await listStates(getDb())}
          submitLabel="Create election and add races →"
        />
      </div>
    </>
  );
}
