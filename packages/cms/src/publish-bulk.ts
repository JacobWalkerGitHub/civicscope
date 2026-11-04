import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import { setCandidacyPublishState } from './candidacies';
import type { Actor } from './changes';
import { setPublishState } from './elections';
import { CmsError, NotFoundError } from './errors';
import { setPersonPublishState } from './people';

const { candidacy, election, person, race } = schema;

export interface BulkPublishSummary {
  elections: number;
  races: number;
  people: number;
  candidacies: number;
  /** Candidates left as they were, and why (the same checks as publishing one by one). */
  skipped: { name: string; reason: string }[];
}

/**
 * Publishes an election (or one of its races) together with its races and candidates,
 * one record at a time through the same checks as the single Publish buttons: a person
 * needs a source; a candidacy needs a sourced status and a source. Only drafts are
 * published: anything an editor unpublished stays unpublished, and archived records are
 * left alone. A candidate that fails a check is skipped and listed, and the rest go on.
 */
export async function publishWithCandidates(
  db: Db,
  actor: Actor,
  target: { electionId: number } | { raceId: number },
): Promise<BulkPublishSummary> {
  const summary: BulkPublishSummary = {
    elections: 0,
    races: 0,
    people: 0,
    candidacies: 0,
    skipped: [],
  };
  const raceRows =
    'raceId' in target
      ? await db.select().from(race).where(eq(race.id, target.raceId))
      : await db
          .select()
          .from(race)
          .where(and(eq(race.electionId, target.electionId), isNull(race.deletedAt)))
          .orderBy(asc(race.name));
  const electionId = 'electionId' in target ? target.electionId : raceRows[0]?.electionId;
  if (electionId == null) throw new NotFoundError('Race');
  const [e] = await db.select().from(election).where(eq(election.id, electionId));
  if (!e) throw new NotFoundError('Election');
  if (e.deletedAt) throw new CmsError('Restore this election before publishing it.');
  if (e.publishState === 'unpublished') {
    throw new CmsError('This election was unpublished. Publish it on its own page first.');
  }
  if (e.publishState === 'draft') {
    await setPublishState(db, actor, 'election', e.id, 'published');
    summary.elections++;
  }

  for (const r of raceRows) {
    if (r.deletedAt || r.publishState === 'unpublished') continue;
    if (r.publishState === 'draft') {
      await setPublishState(db, actor, 'race', r.id, 'published');
      summary.races++;
    }
    const rows = await db
      .select({ candidacy, person })
      .from(candidacy)
      .innerJoin(person, eq(person.id, candidacy.personId))
      .where(and(eq(candidacy.raceId, r.id), isNull(candidacy.deletedAt)))
      .orderBy(asc(person.sortName));
    for (const { candidacy: c, person: p } of rows) {
      if (c.publishState !== 'draft' || p.deletedAt || p.publishState === 'unpublished') {
        continue;
      }
      try {
        if (p.publishState === 'draft') {
          await setPersonPublishState(db, actor, p.id, 'published');
          p.publishState = 'published';
          summary.people++;
        }
        await setCandidacyPublishState(db, actor, c.id, 'published');
        summary.candidacies++;
      } catch (error) {
        if (!(error instanceof CmsError)) throw error;
        summary.skipped.push({ name: `${p.fullName} (${r.name})`, reason: error.message });
      }
    }
  }
  return summary;
}
