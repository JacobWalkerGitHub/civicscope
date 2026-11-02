/**
 * Read queries for the public site. Every query here returns only records that are
 * published and not archived, together with the published parents they depend on
 * (a candidacy shows only when its person, race and election are public too).
 *
 * `preview: true` is for signed-in admins checking drafts before publishing: it
 * also returns drafts and unpublished records, but never archived ones. Public
 * routes must never pass it.
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { todayIso, type CitationSubject } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';

const {
  person,
  candidacy,
  race,
  election,
  office,
  jurisdiction,
  district,
  party,
  claim,
  issue,
  citation,
  source,
} = schema;

export interface ViewOptions {
  /** Include drafts for a signed-in admin's preview. Never set on public routes. */
  preview?: boolean;
}

function visible(
  t: { publishState: MySqlColumn; deletedAt: MySqlColumn },
  { preview = false }: ViewOptions,
): SQL {
  return preview ? isNull(t.deletedAt) : and(eq(t.publishState, 'published'), isNull(t.deletedAt))!;
}

export interface PublicCitation {
  field: string | null;
  excerpt: string | null;
  locator: string | null;
  url: string;
  title: string;
  publisher: string;
  sourceType: string;
  publishedAt: string | null;
  retrievedAt: string;
}

/** Live citations for many records at once, keyed "type:id". */
async function citationsFor(
  db: Db,
  subjects: { type: CitationSubject; ids: number[] }[],
): Promise<Map<string, PublicCitation[]>> {
  const out = new Map<string, PublicCitation[]>();
  const clauses = subjects
    .filter((s) => s.ids.length > 0)
    .map((s) => and(eq(citation.subjectType, s.type), inArray(citation.subjectId, s.ids))!);
  if (clauses.length === 0) return out;
  const rows = await db
    .select({
      subjectType: citation.subjectType,
      subjectId: citation.subjectId,
      field: citation.field,
      excerpt: citation.excerpt,
      locator: citation.locator,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      sourceType: source.sourceType,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
    })
    .from(citation)
    .innerJoin(source, eq(source.id, citation.sourceId))
    .where(and(isNull(citation.deletedAt), isNull(source.deletedAt), or(...clauses)))
    .orderBy(asc(citation.id));
  for (const { subjectType, subjectId, ...cite } of rows) {
    const key = `${subjectType}:${subjectId}`;
    out.set(key, [...(out.get(key) ?? []), cite]);
  }
  return out;
}

export async function getPublicPerson(db: Db, slug: string, opts: ViewOptions = {}) {
  const [p] = await db
    .select({
      id: person.id,
      slug: person.slug,
      fullName: person.fullName,
      preferredName: person.preferredName,
      birthYear: person.birthYear,
      publishState: person.publishState,
      updatedAt: person.updatedAt,
    })
    .from(person)
    .where(and(eq(person.slug, slug), visible(person, opts)));
  if (!p) return null;

  const candidacies = await db
    .select({
      id: candidacy.id,
      ballotName: candidacy.ballotName,
      isIncumbent: candidacy.isIncumbent,
      status: candidacy.status,
      statusDate: candidacy.statusDate,
      campaignUrl: candidacy.campaignUrl,
      publishState: candidacy.publishState,
      partyName: party.name,
      raceId: race.id,
      raceName: race.name,
      electionName: election.name,
      electionDate: election.date,
      electionType: election.type,
    })
    .from(candidacy)
    .innerJoin(race, eq(race.id, candidacy.raceId))
    .innerJoin(election, eq(election.id, race.electionId))
    .leftJoin(party, eq(party.id, candidacy.partyId))
    .where(
      and(
        eq(candidacy.personId, p.id),
        visible(candidacy, opts),
        visible(race, opts),
        visible(election, opts),
      ),
    )
    .orderBy(desc(election.date), asc(race.name));

  const claims = await db
    .select({
      id: claim.id,
      kind: claim.kind,
      contentKind: claim.contentKind,
      title: claim.title,
      summary: claim.summary,
      quote: claim.quote,
      positionType: claim.positionType,
      bioCategory: claim.bioCategory,
      organization: claim.organization,
      statedOn: claim.statedOn,
      venue: claim.venue,
      startYear: claim.startYear,
      endYear: claim.endYear,
      verificationStatus: claim.verificationStatus,
      verifiedAt: claim.verifiedAt,
      publishState: claim.publishState,
      issueId: issue.id,
      issueName: issue.name,
    })
    .from(claim)
    .leftJoin(issue, eq(issue.id, claim.issueId))
    .where(and(eq(claim.personId, p.id), visible(claim, opts)))
    .orderBy(
      asc(claim.kind),
      asc(issue.name),
      desc(claim.statedOn),
      desc(claim.endYear),
      asc(claim.id),
    );

  const citations = await citationsFor(db, [
    { type: 'person', ids: [p.id] },
    { type: 'candidacy', ids: candidacies.map((c) => c.id) },
    { type: 'claim', ids: claims.map((c) => c.id) },
  ]);
  return { person: p, candidacies, claims, citations };
}

export async function getPublicRace(db: Db, id: number, opts: ViewOptions = {}) {
  const [r] = await db
    .select({
      id: race.id,
      name: race.name,
      seats: race.seats,
      isSpecial: race.isSpecial,
      status: race.status,
      publishState: race.publishState,
      primaryPartyName: party.name,
      electionId: election.id,
      electionName: election.name,
      electionDate: election.date,
      electionType: election.type,
      primarySystem: election.primarySystem,
      electionUrl: election.officialUrl,
      officeTitle: office.title,
      officeLevel: office.level,
      jurisdictionName: jurisdiction.name,
      districtName: district.name,
    })
    .from(race)
    .innerJoin(election, eq(election.id, race.electionId))
    .innerJoin(office, eq(office.id, race.officeId))
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .leftJoin(district, eq(district.id, race.districtId))
    .leftJoin(party, eq(party.id, race.partyId))
    .where(and(eq(race.id, id), visible(race, opts), visible(election, opts)));
  if (!r) return null;

  const candidates = await db
    .select({
      candidacyId: candidacy.id,
      ballotName: candidacy.ballotName,
      isIncumbent: candidacy.isIncumbent,
      status: candidacy.status,
      statusDate: candidacy.statusDate,
      publishState: candidacy.publishState,
      partyName: party.name,
      personSlug: person.slug,
      personPublishState: person.publishState,
    })
    .from(candidacy)
    .innerJoin(person, eq(person.id, candidacy.personId))
    .leftJoin(party, eq(party.id, candidacy.partyId))
    .where(and(eq(candidacy.raceId, id), visible(candidacy, opts), visible(person, opts)))
    .orderBy(asc(person.sortName), asc(candidacy.id));

  const citations = await citationsFor(db, [
    { type: 'candidacy', ids: candidates.map((c) => c.candidacyId) },
  ]);
  return { race: r, candidates, citations };
}

/** Upcoming public races, soonest election first, with how many public candidates each has. */
export async function listUpcomingPublicRaces(db: Db, today = todayIso()) {
  return db
    .select({
      id: race.id,
      name: race.name,
      electionName: election.name,
      electionDate: election.date,
      jurisdictionName: jurisdiction.name,
      // Aliased on purpose; see listSources.
      candidateCount: sql<number>`(select count(*) from candidacy c join person p on p.id = c.person_id
        where c.race_id = ${race}.id and c.publish_state = 'published' and c.deleted_at is null
        and p.publish_state = 'published' and p.deleted_at is null)`,
    })
    .from(race)
    .innerJoin(election, eq(election.id, race.electionId))
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .where(and(visible(race, {}), visible(election, {}), gte(election.date, today)))
    .orderBy(asc(election.date), asc(jurisdiction.name), asc(race.name));
}
