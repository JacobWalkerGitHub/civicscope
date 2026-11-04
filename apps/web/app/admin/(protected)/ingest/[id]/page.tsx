import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getIngestRun,
  type CongressRunSummary,
  type CrosswalkSummary,
  type FecRunSummary,
  type ImportSummary,
  type OpenStatesSummary,
  type StateOfficialsSummary,
} from '@civicscope/cms';
import { bioguideUrl } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { dateTime } from '@/lib/labels';
import { requirePermission } from '@/lib/session';
import { runTitle } from '../summaries';

export const metadata: Metadata = { title: 'Automated import run · CivicScope admin' };

const STATE_LABELS = { running: 'Running', succeeded: 'Finished', failed: 'Failed' } as const;

export default async function IngestRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('admin:view');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = await getIngestRun(getDb(), id);
  if (!detail) notFound();
  const { run, batches, pages } = detail;
  return (
    <>
      <p>
        <Link href="/admin/ingest">← Automated imports</Link>
      </p>
      <div className="page-header">
        <h1>
          {runTitle(run.source, run.params)} import, {dateTime.format(run.startedAt)}
        </h1>
        <span className="badge">{STATE_LABELS[run.state]}</span>
      </div>
      {run.error && (
        <p className="alert" role="alert">
          {run.error}
        </p>
      )}
      {run.source === 'fec' && (
        <FecDetail s={run.summary as FecRunSummary | null} pages={pages} batches={batches} />
      )}
      {run.source === 'congress_legislators' && run.summary != null && (
        <CrosswalkDetail s={run.summary as CrosswalkSummary} pages={pages} />
      )}
      {run.source === 'congress_gov' && run.summary != null && (
        <CongressDetail s={run.summary as CongressRunSummary} pages={pages} />
      )}
      {run.source === 'openstates' && run.summary != null && (
        <OpenStatesDetail s={run.summary as OpenStatesSummary} pages={pages} />
      )}
      {run.source === 'state_officials' && run.summary != null && (
        <StateOfficialsDetail s={run.summary as StateOfficialsSummary} pages={pages} />
      )}
    </>
  );
}

type Batches = NonNullable<Awaited<ReturnType<typeof getIngestRun>>>['batches'];

function FecDetail({
  s,
  pages,
  batches,
}: {
  s: FecRunSummary | null;
  pages: number;
  batches: Batches;
}) {
  return (
    <>
      {s && (
        <dl className="facts">
          <dt>Fetched</dt>
          <dd>
            {s.fetched} registrations on {pages} page{pages === 1 ? '' : 's'}
            {s.skippedInactive > 0 && <>, {s.skippedInactive} inactive skipped</>}
          </dd>
          <dt>Races</dt>
          <dd>
            {s.races} races, {s.racesChanged} with changes
          </dd>
          <dt>Candidates</dt>
          <dd>
            {s.counts.create} new, {s.counts.add_to_race} added to a race, {s.counts.update}{' '}
            updated, {s.counts.unchanged} unchanged
          </dd>
          <dt>Conflicts</dt>
          <dd>
            {s.counts.conflicts > 0 ? (
              <Link href="/admin/review">{s.counts.conflicts} in the review queue</Link>
            ) : (
              'None'
            )}
          </dd>
        </dl>
      )}

      {s && s.unknownPartyCodes.length > 0 && (
        <section aria-labelledby="parties-heading">
          <h2 id="parties-heading">Party codes with no party</h2>
          <p>
            These candidates were imported without a party. Add a party with each FEC code on the{' '}
            <Link href="/admin/parties">Parties page</Link>, and the next run fills it in:{' '}
            {s.unknownPartyCodes.map((c, i) => (
              <span key={c}>
                {i > 0 && ', '}
                <code>{c}</code>
              </span>
            ))}
            .
          </p>
        </section>
      )}

      {s && (
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
          {s.attention.length === 0 ? (
            <p className="muted">Nothing.</p>
          ) : (
            <>
              <p className="hint">
                These registrations were not imported. For a possible duplicate, add the FEC ID to
                the right person (on their page, under identifiers) and the next run links them.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">FEC ID</th>
                    <th scope="col">Name</th>
                    <th scope="col">Race</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {s.attention.map((a) => (
                    <tr key={a.fecId}>
                      <td>
                        <a
                          href={`https://www.fec.gov/data/candidate/${a.fecId}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.fecId}
                        </a>
                      </td>
                      <td>{a.name}</td>
                      <td>{a.race}</td>
                      <td>{a.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="changes-heading">
        <h2 id="changes-heading">Races changed ({batches.length})</h2>
        {batches.length === 0 ? (
          <p className="muted">No changes.</p>
        ) : (
          <ul>
            {batches.map((b) => {
              const sum = b.summary as ImportSummary | null;
              return (
                <li key={b.id}>
                  <Link href={`/admin/races/${b.raceId}`}>{b.raceName}</Link>{' '}
                  <span className="muted">
                    {sum &&
                      `· ${sum.create} new, ${sum.add_to_race} added, ${sum.update} updated${sum.conflicts ? `, ${sum.conflicts} conflicts` : ''}`}{' '}
                    · <Link href={`/admin/imports/${b.id}`}>details</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function BioguideLink({ id }: { id: string }) {
  return (
    <a href={bioguideUrl(id)} target="_blank" rel="noopener noreferrer">
      {id}
    </a>
  );
}

function CrosswalkDetail({ s, pages }: { s: CrosswalkSummary; pages: number }) {
  return (
    <>
      <dl className="facts">
        <dt>Fetched</dt>
        <dd>
          {s.fetched} legislators in {pages} files; {s.considered} current or recent members
          considered
        </dd>
        <dt>People</dt>
        <dd>
          {s.created} new drafts, {s.linked} existing people linked, {s.unchanged} unchanged (
          {s.identifiersAdded} IDs added)
        </dd>
      </dl>
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
        {s.attention.length === 0 ? (
          <p className="muted">Nothing.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Bioguide ID</th>
                <th scope="col">Name</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {s.attention.map((a) => (
                <tr key={a.bioguideId}>
                  <td>
                    <BioguideLink id={a.bioguideId} />
                  </td>
                  <td>{a.name}</td>
                  <td>{a.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function CongressDetail({ s, pages }: { s: CongressRunSummary; pages: number }) {
  const tally = (t: { created: number; updated: number; unchanged: number; deferred: number }) =>
    `${t.created} new, ${t.updated} updated, ${t.unchanged} unchanged${t.deferred ? `, ${t.deferred} left for the next run` : ''}`;
  return (
    <>
      {s.stoppedEarly && <p className="hint">{s.stoppedEarly}</p>}
      <dl className="facts">
        <dt>Requests</dt>
        <dd>
          {s.requests} ({pages} responses kept)
        </dd>
        {s.parts.includes('members') && (
          <>
            <dt>Members</dt>
            <dd>{tally(s.members)}</dd>
          </>
        )}
        {s.parts.includes('bills') && (
          <>
            <dt>Bills</dt>
            <dd>
              {tally(s.bills)}; {s.bills.sponsorships} sponsor and cosponsor rows changed
            </dd>
          </>
        )}
        {s.parts.includes('house-votes') && (
          <>
            <dt>House votes</dt>
            <dd>
              {tally(s.votes)}; {s.votes.positions} member votes stored
            </dd>
          </>
        )}
        {s.parts.includes('senate-votes') && s.senateVotes && (
          <>
            <dt>Senate votes</dt>
            <dd>
              {tally(s.senateVotes)}; {s.senateVotes.positions} senator votes stored
            </dd>
          </>
        )}
      </dl>
      <section aria-labelledby="unmatched-heading">
        <h2 id="unmatched-heading">Members with no person here ({s.unmatched.length})</h2>
        {s.unmatched.length === 0 ? (
          <p className="muted">Every member in this run matched a person.</p>
        ) : (
          <>
            <p className="hint">
              Their records are stored and attach as soon as a person has the Bioguide ID. Run the
              crosswalk (<code>pnpm ingest:legislators</code>), or add the ID to the right person by
              hand.
            </p>
            <ul>
              {s.unmatched.map((u) => (
                <li key={u.bioguideId}>
                  <BioguideLink id={u.bioguideId} /> {u.name}
                  {u.state && ` (${u.state})`}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
        {s.attention.length === 0 ? (
          <p className="muted">Nothing.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Name</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {s.attention.map((a, i) => (
                <tr key={`${a.ref}-${i}`}>
                  <td>{a.ref}</td>
                  <td>{a.name}</td>
                  <td>{a.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function OpenStatesDetail({ s, pages }: { s: OpenStatesSummary; pages: number }) {
  return (
    <>
      <dl className="facts">
        <dt>Requests</dt>
        <dd>
          {s.requests} ({pages} responses kept)
        </dd>
        <dt>People</dt>
        <dd>
          {s.created} new drafts, {s.linked} existing people linked, {s.unchanged} unchanged
        </dd>
        {s.states.map((x) => (
          <Fragment key={x.state}>
            <dt>{x.state}</dt>
            <dd>
              {x.legislators} legislators; {x.billPages} pages of bills read, {x.billsWithVotes}{' '}
              with votes ({x.votes} votes); {x.caughtUp ? 'caught up' : 'continues on the next run'}
            </dd>
          </Fragment>
        ))}
      </dl>
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
        {s.attention.length === 0 ? (
          <p className="muted">Nothing.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Open States ID</th>
                <th scope="col">Name</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {s.attention.map((a) => (
                <tr key={a.openstatesId}>
                  <td>
                    <a href={`https://openstates.org/person/${a.openstatesId}`}>{a.openstatesId}</a>
                  </td>
                  <td>{a.name}</td>
                  <td>{a.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function StateOfficialsDetail({ s, pages }: { s: StateOfficialsSummary; pages: number }) {
  return (
    <>
      <dl className="facts">
        <dt>Requests</dt>
        <dd>
          {s.requests} ({pages} changed files kept)
        </dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Governor</th>
            <th scope="col">Legislators</th>
            <th scope="col">Added</th>
            <th scope="col">Changed</th>
            <th scope="col">Left office</th>
            <th scope="col">Refreshed</th>
          </tr>
        </thead>
        <tbody>
          {s.states.map((x) => (
            <tr key={x.state}>
              <th scope="row">{x.state}</th>
              <td>{x.governor ?? '—'}</td>
              <td>{x.legislators}</td>
              <td>{x.added}</td>
              <td>{x.updated}</td>
              <td>{x.left}</td>
              <td>{x.refreshed ? 'Yes' : 'No, kept as it was'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs a person ({s.attention.length})</h2>
        {s.attention.length === 0 ? (
          <p className="muted">Nothing.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {s.attention.map((a, i) => (
                <tr key={`${a.state}-${i}`}>
                  <td>{a.state}</td>
                  <td>{a.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
