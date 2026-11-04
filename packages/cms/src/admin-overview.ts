import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { todayIso } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';

const { election, race, candidacy, person, jurisdiction, bill } = schema;

/** Counts and the next elections for the admin dashboard. */
export async function adminOverview(db: Db, today = todayIso()) {
  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const n = sql<number>`count(*)`;
  const [elections, races, people, candidacies, drafts, bills] = await Promise.all([
    count(
      db
        .select({ n })
        .from(election)
        .where(and(isNull(election.deletedAt), gte(election.date, today))),
    ),
    count(db.select({ n }).from(race).where(isNull(race.deletedAt))),
    count(db.select({ n }).from(person).where(isNull(person.deletedAt))),
    count(db.select({ n }).from(candidacy).where(isNull(candidacy.deletedAt))),
    count(
      db
        .select({ n })
        .from(candidacy)
        .where(and(isNull(candidacy.deletedAt), eq(candidacy.publishState, 'draft'))),
    ),
    count(db.select({ n }).from(bill)),
  ]);
  const upcoming = await db
    .select({
      id: election.id,
      name: election.name,
      date: election.date,
      publishState: election.publishState,
      jurisdictionName: jurisdiction.name,
      raceCount: sql<number>`(select count(*) from ${race} where ${race.electionId} = ${election.id} and ${race.deletedAt} is null)`,
      candidateCount: sql<number>`(select count(*) from ${candidacy} c join ${race} r on r.id = c.race_id where r.election_id = ${election.id} and c.deleted_at is null and r.deleted_at is null)`,
    })
    .from(election)
    .innerJoin(jurisdiction, eq(jurisdiction.id, election.jurisdictionId))
    .where(and(isNull(election.deletedAt), gte(election.date, today)))
    .orderBy(asc(election.date))
    .limit(6);
  return {
    counts: { elections, races, people, candidacies, drafts, bills },
    upcoming: upcoming.map((e) => ({
      ...e,
      raceCount: Number(e.raceCount),
      candidateCount: Number(e.candidateCount),
    })),
  };
}
