import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

/*
 * Senate roll-call votes, from the Senate's own XML files. Congress.gov has no Senate
 * vote endpoint, so these come from senate.gov:
 *
 * - The vote menu for a session lists every roll call in it:
 *   https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_1.xml
 * - Each vote has its own file with every senator's vote:
 *   https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00518.xml
 *
 * Senators are identified by their LIS member ID (e.g. "S428"), not their Bioguide ID;
 * congress-legislators lists both, which is how a vote reaches a CivicScope person.
 * Only the fields CivicScope uses are checked. A file that doesn't match fails the run.
 */

export const SENATE_BASE = 'https://www.senate.gov';
export const LIS_MEMBER_ID = /^S\d{3}$/;

const pad5 = (n: number) => String(n).padStart(5, '0');

export function senateVoteMenuUrl(congress: number, session: number): string {
  return `${SENATE_BASE}/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
}

/** The vote's XML file (what is fetched). */
export function senateVoteXmlUrl(congress: number, session: number, vote: number): string {
  return `${SENATE_BASE}/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${pad5(vote)}.xml`;
}

/** The vote's public page on senate.gov (what is cited). */
export function senateVotePageUrl(congress: number, session: number, vote: number): string {
  return senateVoteXmlUrl(congress, session, vote).replace(/\.xml$/, '.htm');
}

const parser = new XMLParser({
  // Keep every value as text: vote numbers are zero-padded and "document_number" can
  // be "11-13", so nothing is converted behind our back.
  parseTagValue: false,
  ignoreAttributes: true,
  trimValues: true,
  isArray: (name) => name === 'vote' || name === 'member',
});

/** An element that is empty in the XML (`<present/>`) parses as "", which we treat as absent. */
const text = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/\s+/g, ' ').trim() || null : null));
const whole = z.string().regex(/^\d+$/).transform(Number);

export const senateVoteMenuSchema = z.looseObject({
  vote_summary: z.looseObject({
    congress: whole,
    session: whole,
    congress_year: whole,
    votes: z
      .union([
        z.looseObject({
          vote: z.array(
            z.looseObject({
              vote_number: whole,
              /** "18-Dec": day and month only. */
              vote_date: z.string(),
            }),
          ),
        }),
        // A session with no votes yet.
        z.literal(''),
      ])
      .transform((v) => (v === '' ? [] : v.vote)),
  }),
});
export type SenateVoteMenu = z.infer<typeof senateVoteMenuSchema>['vote_summary'];

export const senateVoteSchema = z.looseObject({
  roll_call_vote: z.looseObject({
    congress: whole,
    session: whole,
    vote_number: whole,
    /** "September 15, 2025,  06:15 PM", Eastern time. */
    vote_date: z.string().min(1),
    modify_date: text,
    question: text,
    vote_question_text: text,
    vote_title: text,
    vote_result: text,
    vote_result_text: text,
    majority_requirement: text,
    document: z
      .looseObject({
        document_type: text,
        document_number: text,
        document_name: text,
      })
      .or(z.literal('').transform(() => undefined))
      .optional(),
    amendment: z
      .looseObject({
        amendment_number: text,
        amendment_to_document_number: text,
      })
      .or(z.literal('').transform(() => undefined))
      .optional(),
    tie_breaker: z
      .looseObject({ by_whom: text, tie_breaker_vote: text })
      .or(z.literal('').transform(() => undefined))
      .optional(),
    members: z.looseObject({
      member: z.array(
        z.looseObject({
          lis_member_id: z.string().regex(LIS_MEMBER_ID),
          last_name: text,
          first_name: text,
          party: text,
          state: z.string().regex(/^[A-Z]{2}$/),
          vote_cast: z.string().trim().min(1).max(100),
        }),
      ),
    }),
  }),
});
export type SenateVote = z.infer<typeof senateVoteSchema>['roll_call_vote'];

/** Parses an XML file from senate.gov into a plain object; throws on malformed XML. */
export function parseSenateXml(body: string): unknown {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('<')) throw new Error('not XML');
  return parser.parse(body, true);
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Minutes east of UTC for America/New_York at a given UTC instant (-300 or -240). */
function easternOffsetMinutes(utc: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asIfUtc - utc.getTime()) / 60000);
}

/**
 * "September 15, 2025,  06:15 PM" (Eastern time, as the Senate writes it) to a UTC
 * Date. Null if the text isn't in that form.
 */
export function parseSenateDateTime(s: string): Date | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[6]!.toUpperCase() === 'PM') hour += 12;
  const wall = Date.UTC(Number(m[3]), month - 1, Number(m[2]), hour, Number(m[5]));
  // Guess with the offset at that wall time read as UTC, then correct once: right for
  // every time except the hour that doesn't exist when clocks spring forward.
  let offset = easternOffsetMinutes(new Date(wall));
  offset = easternOffsetMinutes(new Date(wall - offset * 60000));
  const d = new Date(wall - offset * 60000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The measure a Senate vote was on, as the Senate names it. For a vote on an amendment,
 * that is the amendment ("S.Amdt. 1"); otherwise the document ("PN464", "H.R. 4").
 */
export function senateVoteMeasure(v: SenateVote): { type: string; number: string } | null {
  const amdt = v.amendment?.amendment_number;
  if (amdt) {
    const m = /^(.*?)\s*(\d[\w-]*)$/.exec(amdt);
    if (m) return { type: m[1]!.trim() || amdt, number: m[2]! };
  }
  const doc = v.document;
  if (doc?.document_type && doc.document_number) {
    return { type: doc.document_type, number: doc.document_number };
  }
  return null;
}
