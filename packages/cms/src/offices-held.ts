/**
 * What office a person holds now, and what office they have won and are about to take.
 *
 * "Now" comes only from officeholder records that official sources list: Congress.gov
 * memberships and the state officeholders Open States collects from state sites. It is
 * never worked out from a candidacy, a party or an election date.
 *
 * "Next" comes only from a published candidacy whose recorded status is "won" in a
 * general (or special general, or runoff) election. Each status is a dated, sourced
 * event, so the win links to the source a reviewer recorded. The day they take office is
 * shown only when an editor entered it on the race with the official source that sets
 * it; otherwise the page says it is not recorded yet.
 */
import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import {
  congressOn,
  GENERAL_ELECTION_TYPES,
  todayIso,
  type CandidacyStatus,
  type ElectionType,
} from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';

const {
  person,
  personIdentifier,
  candidacy,
  candidacyStatusEvent,
  race,
  election,
  office,
  jurisdiction,
  party,
  source,
  congressMembership,
  stateOfficeholder,
} = schema;

/**
 * How long after election day a win with no recorded start date still shows as the
 * office they are about to take. US terms begin within a few months of the election.
 */
export const NEXT_OFFICE_WINDOW_DAYS = 180;

export interface CurrentCongressSeat {
  kind: 'congress';
  bioguideId: string;
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  partyName: string | null;
  startYear: number;
  sourceUrl: string;
}

export interface CurrentStateOffice {
  kind: 'state';
  osPersonId: string;
  role: 'governor' | 'upper' | 'lower' | 'legislature';
  state: string;
  district: string | null;
  partyName: string | null;
  termStart: string | null;
  lastSeenOn: string;
  sourceUrl: string;
}

export type CurrentOffice = CurrentCongressSeat | CurrentStateOffice;

export interface ElectionOutcome {
  candidacyId: number;
  raceId: number;
  raceName: string;
  officeTitle: string;
  jurisdictionName: string;
  electionId: number;
  electionName: string;
  electionDate: string;
  electionType: ElectionType;
  partyName: string | null;
  status: CandidacyStatus | null;
  statusDate: string | null;
  isIncumbent: boolean;
  termStartsOn: string | null;
  termStartSourceUrl: string | null;
}

export interface NextOffice extends ElectionOutcome {
  /** Where the win was recorded from, if the status event's source is still live. */
  winSource: { url: string; title: string; publisher: string } | null;
}

export interface OfficeTimeline {
  current: CurrentOffice[];
  next: NextOffice[];
  /** Every published candidacy, newest election first. */
  elections: ElectionOutcome[];
}

const isGeneral = (t: ElectionType) => (GENERAL_ELECTION_TYPES as readonly string[]).includes(t);

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether a won race is the office the person is about to take: a general-election win
 * whose recorded start date is still ahead, or, with no start date recorded, a recent one.
 */
export function isUpcomingOffice(
  e: Pick<ElectionOutcome, 'status' | 'electionType' | 'electionDate' | 'termStartsOn'>,
  today = todayIso(),
): boolean {
  if (e.status !== 'won' || !isGeneral(e.electionType)) return false;
  if (e.termStartsOn) return e.termStartsOn > today;
  return e.electionDate <= today && addDays(e.electionDate, NEXT_OFFICE_WINDOW_DAYS) >= today;
}

function visible(t: { publishState: MySqlColumn; deletedAt: MySqlColumn }, preview: boolean): SQL {
  return preview ? isNull(t.deletedAt) : and(eq(t.publishState, 'published'), isNull(t.deletedAt))!;
}

/** The published person linked to an outside ID (a Bioguide or Open States ID), if any. */
export async function publishedPersonFor(
  db: Db,
  scheme: 'bioguide' | 'openstates',
  value: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: person.id })
    .from(personIdentifier)
    .innerJoin(person, eq(person.id, personIdentifier.personId))
    .where(
      and(
        eq(personIdentifier.scheme, scheme),
        eq(personIdentifier.value, value),
        eq(person.publishState, 'published'),
        isNull(person.deletedAt),
      ),
    );
  return row?.id ?? null;
}

async function currentOffices(db: Db, personId: number, today: string): Promise<CurrentOffice[]> {
  const ids = await db
    .select({ scheme: personIdentifier.scheme, value: personIdentifier.value })
    .from(personIdentifier)
    .where(
      and(
        eq(personIdentifier.personId, personId),
        inArray(personIdentifier.scheme, ['bioguide', 'openstates']),
      ),
    );
  const bioguide = ids.filter((i) => i.scheme === 'bioguide').map((i) => i.value);
  const openstates = ids.filter((i) => i.scheme === 'openstates').map((i) => i.value);
  const out: CurrentOffice[] = [];

  if (bioguide.length) {
    const shownSeat = notInArray(congressMembership.publishState, ['unpublished', 'archived']);
    // Same rule as the Politicians list: the sitting Congress, and no end year set.
    const [latest] = await db
      .select({ congress: sql<number>`max(${congressMembership.congress})` })
      .from(congressMembership)
      .where(shownSeat);
    const congress = Math.min(Number(latest?.congress ?? 0), congressOn(today));
    const seats = await db
      .select({
        bioguideId: congressMembership.bioguideId,
        chamber: congressMembership.chamber,
        state: congressMembership.state,
        district: congressMembership.district,
        partyName: congressMembership.partyName,
        startYear: congressMembership.startYear,
        sourceUrl: source.url,
      })
      .from(congressMembership)
      .innerJoin(source, eq(source.id, congressMembership.sourceId))
      .where(
        and(
          inArray(congressMembership.bioguideId, bioguide),
          eq(congressMembership.congress, congress),
          isNull(congressMembership.endYear),
          shownSeat,
        ),
      )
      .orderBy(asc(congressMembership.chamber));
    for (const s of seats) {
      // The first year in this chamber, not just this Congress.
      const [first] = await db
        .select({ year: sql<number>`min(${congressMembership.startYear})` })
        .from(congressMembership)
        .where(
          and(
            eq(congressMembership.bioguideId, s.bioguideId),
            eq(congressMembership.chamber, s.chamber),
            shownSeat,
          ),
        );
      out.push({ kind: 'congress', ...s, startYear: Number(first?.year ?? s.startYear) });
    }
  }

  if (openstates.length) {
    const rows = await db
      .select({
        osPersonId: stateOfficeholder.osPersonId,
        role: stateOfficeholder.role,
        state: stateOfficeholder.state,
        district: stateOfficeholder.district,
        partyName: stateOfficeholder.partyName,
        termStart: stateOfficeholder.termStart,
        lastSeenOn: stateOfficeholder.lastSeenOn,
        sourceUrl: source.url,
      })
      .from(stateOfficeholder)
      .innerJoin(source, eq(source.id, stateOfficeholder.sourceId))
      .where(
        and(
          inArray(stateOfficeholder.osPersonId, openstates),
          isNull(stateOfficeholder.leftOn),
          notInArray(stateOfficeholder.publishState, ['unpublished', 'archived']),
        ),
      )
      .orderBy(desc(stateOfficeholder.lastSeenOn));
    for (const r of rows) out.push({ kind: 'state', ...r });
  }
  return out;
}

/** A person's current office, the office they have won and will take, and every election. */
export async function getOfficeTimeline(
  db: Db,
  personId: number,
  opts: { preview?: boolean; today?: string } = {},
): Promise<OfficeTimeline> {
  const preview = opts.preview ?? false;
  const today = opts.today ?? todayIso();
  const elections: ElectionOutcome[] = await db
    .select({
      candidacyId: candidacy.id,
      raceId: race.id,
      raceName: race.name,
      officeTitle: office.title,
      jurisdictionName: jurisdiction.name,
      electionId: election.id,
      electionName: election.name,
      electionDate: election.date,
      electionType: election.type,
      partyName: party.name,
      status: candidacy.status,
      statusDate: candidacy.statusDate,
      isIncumbent: candidacy.isIncumbent,
      termStartsOn: race.termStartsOn,
      termStartSourceUrl: race.termStartSourceUrl,
    })
    .from(candidacy)
    .innerJoin(race, eq(race.id, candidacy.raceId))
    .innerJoin(election, eq(election.id, race.electionId))
    .innerJoin(office, eq(office.id, race.officeId))
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .leftJoin(party, eq(party.id, candidacy.partyId))
    .where(
      and(
        eq(candidacy.personId, personId),
        visible(candidacy, preview),
        visible(race, preview),
        visible(election, preview),
      ),
    )
    .orderBy(desc(election.date), asc(race.name));

  const upcoming = elections.filter((e) => isUpcomingOffice(e, today));
  const winSources = new Map<number, NextOffice['winSource']>();
  if (upcoming.length) {
    const rows = await db
      .select({
        candidacyId: candidacyStatusEvent.candidacyId,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
      })
      .from(candidacyStatusEvent)
      .innerJoin(source, eq(source.id, candidacyStatusEvent.sourceId))
      .where(
        and(
          inArray(
            candidacyStatusEvent.candidacyId,
            upcoming.map((e) => e.candidacyId),
          ),
          eq(candidacyStatusEvent.status, 'won'),
          isNull(source.deletedAt),
        ),
      )
      // Newest last, so the map keeps the latest recorded win.
      .orderBy(asc(candidacyStatusEvent.effectiveDate), asc(candidacyStatusEvent.id));
    for (const { candidacyId, ...s } of rows) winSources.set(candidacyId, s);
  }

  return {
    current: await currentOffices(db, personId, today),
    next: upcoming.map((e) => ({ ...e, winSource: winSources.get(e.candidacyId) ?? null })),
    elections,
  };
}
