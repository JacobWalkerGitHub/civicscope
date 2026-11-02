import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Db } from '@civicscope/db';

/** States and DC, for pickers. */
export async function listStates(db: Db) {
  return db
    .select({
      id: schema.jurisdiction.id,
      name: schema.jurisdiction.name,
      uspsCode: schema.jurisdiction.uspsCode,
    })
    .from(schema.jurisdiction)
    .where(inArray(schema.jurisdiction.type, ['state', 'federal_district']))
    .orderBy(asc(schema.jurisdiction.name));
}

/** The country plus states and DC: where offices can belong. */
export async function listOfficeJurisdictions(db: Db) {
  return db
    .select({ id: schema.jurisdiction.id, name: schema.jurisdiction.name })
    .from(schema.jurisdiction)
    .where(inArray(schema.jurisdiction.type, ['country', 'state', 'federal_district']))
    .orderBy(asc(schema.jurisdiction.type), asc(schema.jurisdiction.name));
}

export async function listDistricts(db: Db, jurisdictionId: number) {
  return db
    .select({
      id: schema.district.id,
      label: schema.district.label,
      name: schema.district.name,
      type: schema.district.type,
    })
    .from(schema.district)
    .where(
      and(eq(schema.district.jurisdictionId, jurisdictionId), isNull(schema.district.deletedAt)),
    )
    .orderBy(asc(schema.district.type), asc(schema.district.label));
}
