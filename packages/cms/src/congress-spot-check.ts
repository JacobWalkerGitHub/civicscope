import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  LEGISLATORS_BASE,
  legislatorFileSchema,
  parseSenateXml,
  senateVoteSchema,
  type CongressChamber,
  type Legislator,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { fetchText, type FetchOptions } from './ingest-common';

const { candidacy, person, personIdentifier, rollCallVote, votePosition } = schema;

/*
 * Spot check for the Congress import: takes a random sample of stored votes in one
 * chamber that are attached to a CivicScope person and checks each against what the
 * chamber's own record says (the Clerk's for the House, the Senate's for the Senate) and
 * what congress-legislators says about the member. It reads only.
 */

export interface SpotCheckRow {
  roll: string;
  bioguideId: string;
  personId: number;
  personName: string;
  /** The person was already a candidate in CivicScope (e.g. from the FEC import). */
  isCandidate: boolean;
  clerkName: string;
  clerkState: string | null;
  voteCast: string;
  problems: string[];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** The legislator's term on a date, if any. */
function termOn(l: Legislator, date: string) {
  return l.terms.find((t) => t.start <= date && date <= t.end);
}

export async function spotCheckVotes(
  db: Db,
  opts: FetchOptions & {
    sample?: number;
    onlyCandidates?: boolean;
    baseUrl?: string;
    chamber?: CongressChamber;
  } = {},
): Promise<{ checked: number; passed: number; rows: SpotCheckRow[] }> {
  const chamber = opts.chamber ?? 'house';
  const legislators = new Map<string, Legislator>();
  for (const file of ['legislators-current.json', 'legislators-historical.json']) {
    const body = await fetchText(new URL(file, opts.baseUrl ?? LEGISLATORS_BASE), opts);
    for (const l of legislatorFileSchema.parse(JSON.parse(body))) {
      legislators.set(l.id.bioguide, l);
    }
  }
  const candidates = db.select({ personId: candidacy.personId }).from(candidacy);
  const sample = await db
    .select({
      bioguideId: votePosition.bioguideId,
      voteCast: votePosition.voteCast,
      clerkState: votePosition.state,
      votedAt: rollCallVote.votedAt,
      session: rollCallVote.session,
      rollNumber: rollCallVote.rollNumber,
      congress: rollCallVote.congress,
      chamber: rollCallVote.chamber,
      voteId: rollCallVote.id,
      personId: person.id,
      personName: person.fullName,
    })
    .from(votePosition)
    .innerJoin(rollCallVote, eq(rollCallVote.id, votePosition.voteId))
    .innerJoin(
      personIdentifier,
      and(
        eq(personIdentifier.scheme, 'bioguide'),
        eq(personIdentifier.value, votePosition.bioguideId),
      ),
    )
    .innerJoin(person, eq(person.id, personIdentifier.personId))
    .where(
      and(
        eq(rollCallVote.chamber, chamber),
        opts.onlyCandidates ? inArray(person.id, candidates) : undefined,
      ),
    )
    .orderBy(sql`rand()`)
    .limit(opts.sample ?? 60);
  const candidateIds = new Set((await candidates).map((r) => r.personId));

  // The Clerk's names for the sampled members, from the stored raw responses.
  const rows: SpotCheckRow[] = [];
  for (const s of sample) {
    const problems: string[] = [];
    const date = s.votedAt.toISOString().slice(0, 10);
    const l = legislators.get(s.bioguideId);
    const roll5 = String(s.rollNumber).padStart(5, '0');
    const raw = await db
      .select({ body: schema.ingestSnapshot.body })
      .from(schema.ingestSnapshot)
      .where(
        sql`${schema.ingestSnapshot.url} like ${
          chamber === 'house'
            ? `%/house-vote/${s.congress}/${s.session}/${s.rollNumber}/members%`
            : `%/vote${s.congress}${s.session}/vote_${s.congress}_${s.session}_${roll5}.xml`
        }`,
      )
      .orderBy(sql`${schema.ingestSnapshot.id} desc`)
      .limit(1);
    let clerk: { firstName?: string | null; lastName?: string | null } | undefined;
    if (raw[0] && chamber === 'house') {
      clerk = (
        JSON.parse(raw[0].body) as {
          houseRollCallVoteMemberVotes: {
            results: { bioguideID: string; firstName?: string; lastName?: string }[];
          };
        }
      ).houseRollCallVoteMemberVotes.results.find((r) => r.bioguideID === s.bioguideId);
    } else if (raw[0]) {
      // The Senate's file names senators by LIS ID; congress-legislators gives this
      // member's.
      const lis = l?.id.lis;
      const m = senateVoteSchema
        .parse(parseSenateXml(raw[0].body))
        .roll_call_vote.members.member.find((x) => lis && x.lis_member_id === lis);
      if (m) clerk = { firstName: m.first_name, lastName: m.last_name };
    }
    const clerkName = clerk ? `${clerk.firstName ?? ''} ${clerk.lastName ?? ''}`.trim() : '';
    if (!clerk)
      problems.push(
        chamber === 'house'
          ? 'The stored Congress.gov response for this vote does not list the member.'
          : 'The stored senate.gov file for this vote does not list the member’s LIS ID.',
      );
    if (!l) {
      problems.push('congress-legislators has no member with this Bioguide ID.');
    } else {
      const term = termOn(l, date);
      if (!term) problems.push(`congress-legislators has no term for this member on ${date}.`);
      else {
        if (chamber === 'house' && term.type !== 'rep')
          problems.push(`On ${date} this member was a senator, not a representative.`);
        if (chamber === 'senate' && term.type !== 'sen')
          problems.push(`On ${date} this member was a representative, not a senator.`);
        if (s.clerkState && term.state !== s.clerkState) {
          problems.push(
            `The ${chamber === 'house' ? 'Clerk' : 'Senate'} recorded ${s.clerkState}; the member’s term was for ${term.state}.`,
          );
        }
      }
    }
    if (clerk?.lastName && !fold(s.personName).includes(fold(clerk.lastName.split(' ').at(-1)!))) {
      problems.push(
        `The person “${s.personName}” doesn’t share the recorded surname “${clerk.lastName}”.`,
      );
    }
    rows.push({
      roll: `${s.congress}-${s.session}-${s.rollNumber}`,
      bioguideId: s.bioguideId,
      personId: s.personId,
      personName: s.personName,
      isCandidate: candidateIds.has(s.personId),
      clerkName,
      clerkState: s.clerkState,
      voteCast: s.voteCast,
      problems,
    });
  }
  return { checked: rows.length, passed: rows.filter((r) => !r.problems.length).length, rows };
}
