import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { auditLog, jurisdiction } from '../schema/index';
import { COUNTRY_OCD_ID, STATES, STATE_SOURCE_URL, stateOcdId } from './states';

export interface SeedResult {
  inserted: number;
  updated: number;
}

/**
 * Loads the United States and its 50 states + DC. Safe to run repeatedly:
 * rows are matched on OCD ID, and only real changes are written and audited.
 */
export async function seedJurisdictions(db: Db): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const result: SeedResult = { inserted: 0, updated: 0 };

    const upsert = async (row: typeof jurisdiction.$inferInsert) => {
      const [existing] = await tx
        .select()
        .from(jurisdiction)
        .where(eq(jurisdiction.ocdId, row.ocdId));

      if (!existing) {
        const [res] = await tx.insert(jurisdiction).values(row);
        await tx.insert(auditLog).values({
          actorType: 'system',
          actorId: 'seed:jurisdictions',
          action: 'create',
          entityType: 'jurisdiction',
          entityId: String(res.insertId),
          diff: row,
          note: `Seeded from ${STATE_SOURCE_URL}`,
        });
        result.inserted += 1;
        return res.insertId;
      }

      const changes: Record<string, [unknown, unknown]> = {};
      for (const key of ['parentId', 'type', 'name', 'uspsCode', 'fips', 'ansiCode'] as const) {
        if ((existing[key] ?? null) !== (row[key] ?? null)) {
          changes[key] = [existing[key] ?? null, row[key] ?? null];
        }
      }
      if (Object.keys(changes).length > 0) {
        await tx.update(jurisdiction).set(row).where(eq(jurisdiction.id, existing.id));
        await tx.insert(auditLog).values({
          actorType: 'system',
          actorId: 'seed:jurisdictions',
          action: 'update',
          entityType: 'jurisdiction',
          entityId: String(existing.id),
          diff: changes,
          note: `Seeded from ${STATE_SOURCE_URL}`,
        });
        result.updated += 1;
      }
      return existing.id;
    };

    const countryId = await upsert({
      type: 'country',
      name: 'United States',
      ocdId: COUNTRY_OCD_ID,
      parentId: null,
    });

    for (const s of STATES) {
      await upsert({
        parentId: countryId,
        type: s.usps === 'DC' ? 'federal_district' : 'state',
        name: s.name,
        uspsCode: s.usps,
        fips: s.fips,
        ansiCode: s.ansi,
        ocdId: stateOcdId(s.usps),
      });
    }

    // Guard against a partial seed: the count must be exact.
    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)` })
      .from(jurisdiction)
      .where(sql`${jurisdiction.type} IN ('state', 'federal_district')`)) as [{ count: number }];
    if (Number(count) !== STATES.length) {
      throw new Error(`Expected ${STATES.length} states + DC, found ${count}`);
    }

    return result;
  });
}
