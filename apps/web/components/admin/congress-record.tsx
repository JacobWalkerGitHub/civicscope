import { getCongressRecord } from '@civicscope/cms';
import { billLabel, congressGovBillUrl } from '@civicscope/core';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/labels';
import { voteDate, voteMeasure } from '../congress-format';

/**
 * A person's record in Congress, found through their Bioguide ID: seats held, bills
 * sponsored and recent House and Senate votes. Imported from Congress.gov and senate.gov
 * as drafts; shown here so an editor can check what attached to this person.
 */
export async function CongressRecord({ personId }: { personId: number }) {
  const record = await getCongressRecord(getDb(), personId);
  if (!record) return null;
  const { memberships, bills, votes } = record;
  const nothing = !memberships.length && !bills.length && !votes.length;
  return (
    <section aria-labelledby="congress-heading">
      <h2 id="congress-heading">Record in Congress</h2>
      <p className="muted">
        Imported from Congress.gov and senate.gov for Bioguide ID {record.bioguideIds.join(', ')}.
        They are shown on the public profile once the person is published.
      </p>
      {nothing && <p className="muted">Nothing imported for this ID yet.</p>}
      {memberships.length > 0 && (
        <>
          <h3>Seats</h3>
          <ul>
            {memberships.map((m) => (
              <li key={m.id}>
                {m.congress}th Congress: {m.chamber === 'senate' ? 'Senate' : 'House'}, {m.state}
                {m.chamber === 'house' && (m.district ? ` District ${m.district}` : ' at-large')}
                {m.partyName && ` (${m.partyName})`}
              </li>
            ))}
          </ul>
        </>
      )}
      {bills.length > 0 && (
        <>
          <h3>
            Bills ({record.sponsorCount} sponsored, {record.cosponsorCount} cosponsored)
          </h3>
          <ul>
            {bills.map((b) => (
              <li key={b.id}>
                <a
                  href={congressGovBillUrl(b.congress, b.billType, b.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {billLabel(b.billType, b.number)}
                </a>{' '}
                {b.title}{' '}
                <span className="muted">
                  · {b.role === 'sponsor' ? 'Sponsor' : 'Cosponsor'}
                  {b.sponsoredOn && `, ${formatDate(b.sponsoredOn)}`}
                  {b.withdrawnOn && ` (withdrew ${formatDate(b.withdrawnOn)})`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {votes.length > 0 && (
        <>
          <h3>Recent votes ({record.voteCount} in all)</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Roll call</th>
                <th scope="col">Chamber</th>
                <th scope="col">Question</th>
                <th scope="col">Vote</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {votes.map((v) => {
                const measure = voteMeasure(v);
                return (
                  <tr key={v.id}>
                    <td>{voteDate.format(v.votedAt)}</td>
                    <td>
                      {v.rollNumber} ({v.congress}-{v.session})
                    </td>
                    <td>{v.chamber === 'senate' ? 'Senate' : 'House'}</td>
                    <td>
                      {v.question}
                      {measure && ` (${measure})`}
                    </td>
                    <td>{v.voteCast}</td>
                    <td>{v.result}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
