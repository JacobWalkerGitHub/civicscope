import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';
import { createDeadline, createResource } from './calendar';
import type { CalendarData } from './calendar-data/2027';
import type { Actor } from './changes';
import { createElection } from './elections';

const { election, electionDeadline, jurisdiction, officialResource } = schema;

export interface CalendarLoadSummary {
  electionsCreated: number;
  electionsExisting: number;
  deadlinesCreated: number;
  deadlinesExisting: number;
  resourcesCreated: number;
  resourcesExisting: number;
  /** Stored values that differ from the reviewed file; left for an editor. */
  differences: string[];
}

/**
 * Loads a reviewed calendar file through the normal CMS functions, so every record is
 * validated and audited as the admin who runs it. Elections are created as drafts.
 * Safe to run again: anything already stored is left alone, and a stored value that
 * differs from the file is listed rather than overwritten (an editor may have fixed it).
 */
export async function loadCalendar(
  db: Db,
  actor: Actor,
  data: CalendarData,
): Promise<CalendarLoadSummary> {
  const s: CalendarLoadSummary = {
    electionsCreated: 0,
    electionsExisting: 0,
    deadlinesCreated: 0,
    deadlinesExisting: 0,
    resourcesCreated: 0,
    resourcesExisting: 0,
    differences: [],
  };
  const states = new Map(
    (await db.select({ id: jurisdiction.id, code: jurisdiction.uspsCode }).from(jurisdiction)).map(
      (j) => [j.code, j.id] as const,
    ),
  );
  const stateId = (code: string) => {
    const id = states.get(code);
    if (!id) throw new Error(`No jurisdiction with USPS code ${code}. Run pnpm db:seed first.`);
    return id;
  };

  for (const e of data.elections) {
    const jurisdictionId = stateId(e.state);
    const [found] = await db
      .select()
      .from(election)
      .where(
        and(
          eq(election.jurisdictionId, jurisdictionId),
          eq(election.type, e.type),
          eq(election.date, e.date),
        ),
      );
    let electionId: number;
    if (found) {
      electionId = found.id;
      s.electionsExisting++;
      if (found.deletedAt) {
        s.differences.push(`${e.name}: archived here; its dates were not loaded.`);
        continue;
      }
      if (found.primarySystem !== e.primarySystem) {
        s.differences.push(
          `${e.name}: stored primary system is ${found.primarySystem}, the file says ${e.primarySystem}.`,
        );
      }
    } else {
      electionId = await createElection(db, actor, {
        jurisdictionId: String(jurisdictionId),
        type: e.type,
        primarySystem: e.primarySystem,
        date: e.date,
        name: e.name,
        officialUrl: e.officialUrl,
      });
      s.electionsCreated++;
    }
    const stored = await db
      .select()
      .from(electionDeadline)
      .where(eq(electionDeadline.electionId, electionId));
    for (const d of e.deadlines) {
      const same = stored.find((x) => x.kind === d.kind && x.label === d.label);
      if (same) {
        s.deadlinesExisting++;
        if (same.date !== d.date || same.sourceUrl !== d.sourceUrl) {
          s.differences.push(
            `${e.name}, “${d.label}”: stored ${same.date}, the file says ${d.date}.`,
          );
        }
        continue;
      }
      await createDeadline(db, actor, { ...d, electionId: String(electionId) });
      s.deadlinesCreated++;
    }
  }

  for (const r of data.resources) {
    const jurisdictionId = stateId(r.state);
    const [found] = await db
      .select({ id: officialResource.id })
      .from(officialResource)
      .where(
        and(
          eq(officialResource.jurisdictionId, jurisdictionId),
          eq(officialResource.url, r.url),
          isNull(officialResource.deletedAt),
        ),
      );
    if (found) {
      s.resourcesExisting++;
      continue;
    }
    await createResource(db, actor, { ...r, jurisdictionId: String(jurisdictionId) });
    s.resourcesCreated++;
  }
  return s;
}
