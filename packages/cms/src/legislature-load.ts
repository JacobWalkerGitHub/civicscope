import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { PARTISAN_PRIMARY_SYSTEMS, racePartyRule } from '@civicscope/core';
import { schema, type Db } from '@civicscope/db';
import { recordChange, type Actor } from './changes';
import { createRace } from './elections';
import {
  districtOcdId,
  districtType,
  type LegislatureData,
  type LegislativeChamberData,
} from './legislature-data/2027';
import { createOffice } from './offices';
import { createParty } from './parties';

const { district, election, jurisdiction, office, party, race } = schema;

/** The parties that get a primary race in every district of a partisan-primary state. */
const MAJOR_PARTIES = [
  { fecCode: 'DEM', name: 'Democratic Party', shortName: 'Democratic' },
  { fecCode: 'REP', name: 'Republican Party', shortName: 'Republican' },
] as const;

export interface LegislatureLoadSummary {
  officesCreated: number;
  officesExisting: number;
  districtsCreated: number;
  districtsExisting: number;
  racesCreated: number;
  racesExisting: number;
  /** States whose legislature is loaded but which have no 2027 elections yet. */
  statesWithoutElections: string[];
  differences: string[];
}

/**
 * Loads the reviewed legislature file: one office per chamber, its districts, and a
 * draft race in every district for each of the state's elections that year (one per
 * major party in a partisan primary). Everything goes through the CMS functions or the
 * audit log as the admin who runs it. Safe to run again, and worth running again after
 * new elections are added: only what is missing is created, and a stored office that
 * differs from the file is listed rather than changed.
 */
export async function loadLegislatures(
  db: Db,
  actor: Actor,
  data: LegislatureData,
): Promise<LegislatureLoadSummary> {
  const s: LegislatureLoadSummary = {
    officesCreated: 0,
    officesExisting: 0,
    districtsCreated: 0,
    districtsExisting: 0,
    racesCreated: 0,
    racesExisting: 0,
    statesWithoutElections: [],
    differences: [],
  };
  const year = data.districtsValidFrom.slice(0, 4);
  const parties = await majorParties(db, actor);

  for (const c of data.chambers) {
    const [state] = await db.select().from(jurisdiction).where(eq(jurisdiction.uspsCode, c.state));
    if (!state)
      throw new Error(`No jurisdiction with USPS code ${c.state}. Run pnpm db:seed first.`);

    const officeId = await ensureOffice(db, actor, state.id, c, s);
    const districtIds = await ensureDistricts(db, actor, state, c, data.districtsValidFrom, s);

    const elections = await db
      .select()
      .from(election)
      .where(
        and(
          eq(election.jurisdictionId, state.id),
          gte(election.date, `${year}-01-01`),
          lt(election.date, `${Number(year) + 1}-01-01`),
          isNull(election.deletedAt),
          inArray(election.type, ['primary', 'general']),
        ),
      );
    if (elections.length === 0) {
      if (!s.statesWithoutElections.includes(c.state)) s.statesWithoutElections.push(c.state);
      continue;
    }

    const existing = new Set(
      (
        await db
          .select({ key: race.contestKey })
          .from(race)
          .where(
            and(
              eq(race.officeId, officeId),
              inArray(
                race.electionId,
                elections.map((e) => e.id),
              ),
            ),
          )
      ).map((r) => r.key),
    );

    for (const e of elections) {
      const partisan = racePartyRule(e.type, e.primarySystem) === 'required';
      if (partisan && !(PARTISAN_PRIMARY_SYSTEMS as readonly string[]).includes(e.primarySystem)) {
        s.differences.push(
          `${e.name}: needs a party per race but is not a party primary; skipped.`,
        );
        continue;
      }
      for (const [n, districtId] of districtIds) {
        for (const p of partisan ? parties : [null]) {
          const key = [e.id, officeId, districtId, p?.id ?? 0, 0].join('-');
          if (existing.has(key)) {
            s.racesExisting++;
            continue;
          }
          await createRace(db, actor, {
            electionId: String(e.id),
            officeId: String(officeId),
            districtId: String(districtId),
            partyId: p ? String(p.id) : '',
            name: `${c.title}, District ${n}${p ? ` (${p.shortName} primary)` : ''}`,
            seats: String(c.seatsPerDistrict),
          });
          s.racesCreated++;
        }
      }
    }
  }
  return s;
}

async function majorParties(db: Db, actor: Actor) {
  const out: { id: number; shortName: string }[] = [];
  for (const p of MAJOR_PARTIES) {
    const [found] = await db
      .select()
      .from(party)
      .where(and(eq(party.fecCode, p.fecCode), isNull(party.deletedAt)));
    const id =
      found?.id ??
      (await createParty(db, actor, { name: p.name, shortName: p.shortName, fecCode: p.fecCode }));
    out.push({ id, shortName: found?.shortName || p.shortName });
  }
  return out;
}

async function ensureOffice(
  db: Db,
  actor: Actor,
  jurisdictionId: number,
  c: LegislativeChamberData,
  s: LegislatureLoadSummary,
): Promise<number> {
  const [found] = await db
    .select()
    .from(office)
    .where(
      and(
        eq(office.jurisdictionId, jurisdictionId),
        eq(office.branch, 'legislative'),
        eq(office.chamber, c.chamber),
        isNull(office.deletedAt),
      ),
    );
  if (found) {
    s.officesExisting++;
    if (found.seats !== c.seatsPerDistrict || found.termYears !== c.termYears) {
      s.differences.push(
        `${found.title}: stored ${found.seats} seat(s) per district and ${found.termYears ?? '?'}-year terms; ` +
          `the file says ${c.seatsPerDistrict} and ${c.termYears}.`,
      );
    }
    return found.id;
  }
  s.officesCreated++;
  return createOffice(db, actor, {
    jurisdictionId: String(jurisdictionId),
    title: c.title,
    level: 'state',
    branch: 'legislative',
    chamber: c.chamber,
    seats: String(c.seatsPerDistrict),
    termYears: String(c.termYears),
    isPartisan: 'on',
  });
}

async function ensureDistricts(
  db: Db,
  actor: Actor,
  state: typeof jurisdiction.$inferSelect,
  c: LegislativeChamberData,
  validFrom: string,
  s: LegislatureLoadSummary,
): Promise<Map<number, number>> {
  const type = districtType(c.chamber);
  const stored = new Map(
    (
      await db
        .select({ id: district.id, ocdId: district.ocdId })
        .from(district)
        .where(
          and(
            eq(district.jurisdictionId, state.id),
            eq(district.type, type),
            eq(district.validFrom, validFrom),
            isNull(district.deletedAt),
          ),
        )
    ).map((d) => [d.ocdId, d.id] as const),
  );
  const ids = new Map<number, number>();
  const chamberName = c.chamber === 'upper' ? 'Senate' : 'House';
  for (let n = 1; n <= c.districts; n++) {
    const ocdId = districtOcdId(c.state, c.chamber, n);
    const found = stored.get(ocdId);
    if (found) {
      s.districtsExisting++;
      ids.set(n, found);
      continue;
    }
    const id = await db.transaction(async (tx) => {
      const [res] = await tx.insert(district).values({
        jurisdictionId: state.id,
        type,
        label: String(n),
        name: `${state.name} ${chamberName} District ${n}`,
        ocdId,
        validFrom,
      });
      const [created] = await tx.select().from(district).where(eq(district.id, res.insertId));
      await recordChange(tx, actor, {
        entityType: 'district',
        entityId: res.insertId,
        action: 'create',
        before: null,
        after: created!,
        note: `Loaded from the reviewed legislature file (${c.sourceUrl})`,
      });
      return res.insertId;
    });
    s.districtsCreated++;
    ids.set(n, id);
  }
  return ids;
}
