/**
 * Public search, side-by-side comparison and issue pages. Like public.ts, every query
 * returns only published, unarchived records whose parents are public too, unless an
 * admin preview asks for drafts.
 *
 * Nothing here fills a gap: a candidate with no published position on an issue shows as
 * having none on file, never as holding a view inferred from party or anyone else.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { todayIso } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { getCompareRecords, getSharedVotes } from './compare-record';
import { getPublicRace, type PublicCitation, type ViewOptions } from './public';

const {
  candidacy,
  citation,
  claim,
  district,
  election,
  issue,
  jurisdiction,
  office,
  party,
  person,
  race,
  source,
} = schema;

function visible(
  t: { publishState: MySqlColumn; deletedAt: MySqlColumn },
  { preview = false }: ViewOptions,
): SQL {
  return preview ? isNull(t.deletedAt) : and(eq(t.publishState, 'published'), isNull(t.deletedAt))!;
}

/** A public candidacy: the candidacy, its person, race and election are all public. */
const liveCandidacy = (opts: ViewOptions) =>
  and(
    visible(candidacy, opts),
    visible(person, opts),
    visible(race, opts),
    visible(election, opts),
  )!;

/** Words of a query, lowercased, without LIKE wildcards; at most 8. */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[%_\\]/g, ' ')
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 8);
}

/** Every word must appear somewhere in the given text. */
const allWords = (haystack: SQL, words: string[]) =>
  and(...words.map((w) => sql`lower(${haystack}) like ${`%${w}%`}`))!;

/** Words for MySQL's boolean full-text mode: each required, matched as a prefix. */
function fullTextQuery(words: string[]): string | null {
  const usable = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length >= 3);
  return usable.length ? usable.map((w) => `+${w}*`).join(' ') : null;
}

export const SEARCH_LIMIT = 25;

/**
 * Searches candidates (by name, party, state, office or district), races (by name,
 * office, state or district), issues, and the text of published profile entries.
 * Upcoming elections only, unless `includePast`.
 */
export async function searchPublic(
  db: Db,
  q: string,
  opts: { includePast?: boolean; today?: string } = {},
) {
  const words = searchTerms(q);
  const empty = { words, candidates: [], races: [], issues: [], entries: [] };
  if (!words.length || words.join('').length < 2) return empty;
  const today = opts.today ?? todayIso();
  const upcoming = opts.includePast ? undefined : gte(election.date, today);

  const raceText = sql`concat_ws(' ', ${race.name}, ${office.title}, ${jurisdiction.name}, ${jurisdiction.uspsCode}, ${district.name}, ${district.label})`;
  const candidates = await db
    .select({
      candidacyId: candidacy.id,
      ballotName: candidacy.ballotName,
      personSlug: person.slug,
      photoId: person.photoId,
      partyName: party.name,
      isIncumbent: candidacy.isIncumbent,
      raceId: race.id,
      raceName: race.name,
      electionName: election.name,
      electionDate: election.date,
    })
    .from(candidacy)
    .innerJoin(person, eq(person.id, candidacy.personId))
    .innerJoin(race, eq(race.id, candidacy.raceId))
    .innerJoin(election, eq(election.id, race.electionId))
    .innerJoin(office, eq(office.id, race.officeId))
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .leftJoin(district, eq(district.id, race.districtId))
    .leftJoin(party, eq(party.id, candidacy.partyId))
    .where(
      and(
        liveCandidacy({}),
        upcoming,
        allWords(
          sql`concat_ws(' ', ${person.fullName}, ${person.preferredName}, ${candidacy.ballotName}, ${party.name}, ${raceText})`,
          words,
        ),
      ),
    )
    .orderBy(asc(person.sortName), asc(election.date))
    .limit(SEARCH_LIMIT);

  const races = await db
    .select({
      id: race.id,
      name: race.name,
      electionName: election.name,
      electionDate: election.date,
      jurisdictionName: jurisdiction.name,
    })
    .from(race)
    .innerJoin(election, eq(election.id, race.electionId))
    .innerJoin(office, eq(office.id, race.officeId))
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .leftJoin(district, eq(district.id, race.districtId))
    .where(and(visible(race, {}), visible(election, {}), upcoming, allWords(raceText, words)))
    .orderBy(asc(election.date), asc(race.name))
    .limit(SEARCH_LIMIT);

  const issues = await db
    .select({ slug: issue.slug, name: issue.name, description: issue.description })
    .from(issue)
    .where(
      and(
        isNull(issue.deletedAt),
        allWords(sql`concat_ws(' ', ${issue.name}, ${issue.description})`, words),
      ),
    )
    .orderBy(asc(issue.name))
    .limit(SEARCH_LIMIT);

  // Entries: full-text on title and summary, for public candidates in public races.
  const ft = fullTextQuery(words);
  const entries = ft
    ? await db
        .selectDistinct({
          id: claim.id,
          kind: claim.kind,
          title: claim.title,
          personSlug: person.slug,
          personName: person.fullName,
          sortName: person.sortName,
          issueName: issue.name,
        })
        .from(claim)
        .innerJoin(person, eq(person.id, claim.personId))
        .innerJoin(candidacy, eq(candidacy.personId, person.id))
        .innerJoin(race, eq(race.id, candidacy.raceId))
        .innerJoin(election, eq(election.id, race.electionId))
        .leftJoin(issue, eq(issue.id, claim.issueId))
        .where(
          and(
            visible(claim, {}),
            liveCandidacy({}),
            upcoming,
            sql`match(${claim.title}, ${claim.summary}) against (${ft} in boolean mode)`,
          ),
        )
        .orderBy(asc(person.sortName), asc(claim.title))
        .limit(SEARCH_LIMIT)
    : [];

  return { words, candidates, races, issues, entries };
}

// ---------------------------------------------------------------------------------
// Comparison

export const COMPARE_MAX = 6;

async function citationsFor(db: Db, type: 'claim' | 'candidacy', ids: number[]) {
  const out = new Map<number, PublicCitation[]>();
  if (!ids.length) return out;
  const rows = await db
    .select({
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
    .where(
      and(
        eq(citation.subjectType, type),
        inArray(citation.subjectId, ids),
        isNull(citation.deletedAt),
        isNull(source.deletedAt),
      ),
    )
    .orderBy(asc(citation.id));
  for (const { subjectId, ...c } of rows) out.set(subjectId, [...(out.get(subjectId) ?? []), c]);
  return out;
}

/**
 * Candidates in one race, side by side. Only candidates in that race can be compared:
 * IDs from any other race are dropped. With no usable IDs, the first COMPARE_MAX public
 * candidates (alphabetical) are shown. Rows are every issue on which at least one of
 * them has a published position; a candidate with none on that issue gets an empty
 * cell, never a guess.
 */
export async function getPublicComparison(
  db: Db,
  raceId: number,
  candidacyIds: number[] = [],
  opts: ViewOptions = {},
) {
  const page = await getPublicRace(db, raceId, opts);
  if (!page) return null;
  const inRace = page.candidates;
  const picked = inRace.filter((c) => candidacyIds.includes(c.candidacyId));
  // If none of the requested IDs belong here, fall back to the race's own candidates.
  const wanted = picked.length ? picked : inRace;
  const chosen = wanted.slice(0, COMPARE_MAX);
  const ignored = candidacyIds.filter((id) => !inRace.some((c) => c.candidacyId === id));

  const people = chosen.length
    ? await db
        .select({ candidacyId: candidacy.id, personId: candidacy.personId })
        .from(candidacy)
        .where(
          inArray(
            candidacy.id,
            chosen.map((c) => c.candidacyId),
          ),
        )
    : [];
  const personOf = new Map(people.map((p) => [p.candidacyId, p.personId] as const));
  const personIds = [...new Set(people.map((p) => p.personId))];

  const claims = personIds.length
    ? await db
        .select({
          id: claim.id,
          personId: claim.personId,
          kind: claim.kind,
          contentKind: claim.contentKind,
          title: claim.title,
          summary: claim.summary,
          positionType: claim.positionType,
          bioCategory: claim.bioCategory,
          organization: claim.organization,
          statedOn: claim.statedOn,
          startYear: claim.startYear,
          endYear: claim.endYear,
          verificationStatus: claim.verificationStatus,
          verifiedAt: claim.verifiedAt,
          publishState: claim.publishState,
          issueId: claim.issueId,
        })
        .from(claim)
        .where(and(inArray(claim.personId, personIds), visible(claim, opts)))
        .orderBy(desc(claim.statedOn), desc(claim.endYear), asc(claim.id))
    : [];
  const issueIds = [...new Set(claims.map((c) => c.issueId).filter((x): x is number => !!x))];
  const issues = issueIds.length
    ? await db
        .select({ id: issue.id, slug: issue.slug, name: issue.name })
        .from(issue)
        .where(and(inArray(issue.id, issueIds), isNull(issue.deletedAt)))
        .orderBy(asc(issue.name))
    : [];
  const citations = {
    claim: await citationsFor(
      db,
      'claim',
      claims.map((c) => c.id),
    ),
    candidacy: page.citations,
  };
  const [records, sharedVotes] = await Promise.all([
    getCompareRecords(db, personIds, opts),
    getSharedVotes(db, personIds, opts),
  ]);
  const columns = chosen.map((c) => {
    const pid = personOf.get(c.candidacyId)!;
    const mine = claims.filter((x) => x.personId === pid);
    return {
      ...c,
      positions: mine.filter((x) => x.kind === 'position'),
      biography: mine.filter((x) => x.kind === 'biography'),
      accomplishments: mine.filter((x) => x.kind === 'accomplishment'),
      /** Seats, bills and vote counts from official records; null fields mean none on file. */
      record: records.get(pid)!,
      /** The campaign's latest FEC totals, when the FEC reports on this candidate. */
      money: page.money.get(c.candidacyId) ?? null,
    };
  });
  return {
    race: page.race,
    candidatesInRace: inRace,
    columns,
    issues,
    citations,
    /** Roll calls at least two of the compared candidates voted on, keyed by person ID. */
    sharedVotes,
    /** Requested IDs that are not public candidates in this race. */
    ignored,
  };
}

// ---------------------------------------------------------------------------------
// Issues

/** Issues with how many public candidates in upcoming races have a position on each. */
export async function listPublicIssues(db: Db, today = todayIso()) {
  const rows = await db
    .select({
      id: issue.id,
      slug: issue.slug,
      name: issue.name,
      description: issue.description,
      candidates: sql<number>`count(distinct ${claim.personId})`,
    })
    .from(issue)
    .leftJoin(
      claim,
      and(
        eq(claim.issueId, issue.id),
        visible(claim, {}),
        inArray(
          claim.personId,
          db
            .select({ id: candidacy.personId })
            .from(candidacy)
            .innerJoin(person, eq(person.id, candidacy.personId))
            .innerJoin(race, eq(race.id, candidacy.raceId))
            .innerJoin(election, eq(election.id, race.electionId))
            .where(and(liveCandidacy({}), gte(election.date, today))),
        ),
      ),
    )
    .where(isNull(issue.deletedAt))
    .groupBy(issue.id)
    .orderBy(asc(issue.name));
  return rows.map((r) => ({ ...r, candidates: Number(r.candidates) }));
}

/**
 * One issue: published positions of public candidates in upcoming public races, grouped
 * by race. Candidates with no position on it are counted, not listed as opposed.
 */
export async function getPublicIssue(db: Db, slug: string, today = todayIso()) {
  const [i] = await db
    .select()
    .from(issue)
    .where(and(eq(issue.slug, slug), isNull(issue.deletedAt)));
  if (!i) return null;
  const rows = await db
    .select({
      claimId: claim.id,
      title: claim.title,
      summary: claim.summary,
      positionType: claim.positionType,
      contentKind: claim.contentKind,
      statedOn: claim.statedOn,
      verificationStatus: claim.verificationStatus,
      candidacyId: candidacy.id,
      ballotName: candidacy.ballotName,
      personSlug: person.slug,
      partyName: party.name,
      raceId: race.id,
      raceName: race.name,
      electionName: election.name,
      electionDate: election.date,
    })
    .from(claim)
    .innerJoin(person, eq(person.id, claim.personId))
    .innerJoin(candidacy, eq(candidacy.personId, person.id))
    .innerJoin(race, eq(race.id, candidacy.raceId))
    .innerJoin(election, eq(election.id, race.electionId))
    .leftJoin(party, eq(party.id, candidacy.partyId))
    .where(
      and(
        eq(claim.issueId, i.id),
        eq(claim.kind, 'position'),
        visible(claim, {}),
        liveCandidacy({}),
        gte(election.date, today),
      ),
    )
    .orderBy(asc(election.date), asc(race.name), asc(person.sortName), desc(claim.statedOn));
  const citations = await citationsFor(db, 'claim', [...new Set(rows.map((r) => r.claimId))]);
  const races = new Map<
    number,
    {
      raceId: number;
      raceName: string;
      electionName: string;
      electionDate: string;
      rows: typeof rows;
    }
  >();
  for (const r of rows) {
    const g = races.get(r.raceId) ?? {
      raceId: r.raceId,
      raceName: r.raceName,
      electionName: r.electionName,
      electionDate: r.electionDate,
      rows: [],
    };
    g.rows.push(r);
    races.set(r.raceId, g);
  }
  // How many public candidates each race has, to say how many have nothing on file.
  const raceIds = [...races.keys()];
  const counts = raceIds.length
    ? await db
        .select({ raceId: candidacy.raceId, n: sql<number>`count(*)` })
        .from(candidacy)
        .innerJoin(person, eq(person.id, candidacy.personId))
        .innerJoin(race, eq(race.id, candidacy.raceId))
        .innerJoin(election, eq(election.id, race.electionId))
        .where(and(inArray(candidacy.raceId, raceIds), liveCandidacy({})))
        .groupBy(candidacy.raceId)
    : [];
  return {
    issue: i,
    races: [...races.values()].map((g) => ({
      ...g,
      candidateCount: Number(counts.find((c) => c.raceId === g.raceId)?.n ?? 0),
      withPosition: new Set(g.rows.map((r) => r.candidacyId)).size,
    })),
    citations,
  };
}
