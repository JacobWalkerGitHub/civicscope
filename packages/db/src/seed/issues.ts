import { eq } from 'drizzle-orm';
import { slugify } from '@civicscope/core';
import type { Db } from '../client';
import { auditLog, issue } from '../schema/index';

/**
 * Starting list of broad policy areas, named in plain, neutral terms (following AP
 * style where a term is contested). Admins can rename, add or archive issues; the seed
 * only adds names that are missing and never changes existing ones.
 */
export const DEFAULT_ISSUES = [
  'Abortion',
  'Agriculture',
  'Civil rights and liberties',
  'Criminal justice and public safety',
  'Economy and jobs',
  'Education',
  'Elections and government',
  'Energy',
  'Environment',
  'Foreign policy',
  'Gun policy',
  'Health care',
  'Housing',
  'Immigration',
  'Infrastructure and transportation',
  'Labor',
  'National security and defense',
  'Social Security and Medicare',
  'Taxes and budget',
  'Technology',
  'Veterans',
] as const;

export async function seedIssues(db: Db): Promise<{ inserted: number }> {
  return db.transaction(async (tx) => {
    let inserted = 0;
    for (const name of DEFAULT_ISSUES) {
      const slug = slugify(name);
      const [existing] = await tx.select().from(issue).where(eq(issue.slug, slug));
      if (existing) continue;
      const [res] = await tx.insert(issue).values({ slug, name });
      await tx.insert(auditLog).values({
        actorType: 'system',
        actorId: 'seed:issues',
        action: 'create',
        entityType: 'issue',
        entityId: String(res.insertId),
        diff: { name: [null, name] },
        note: 'Default issue list',
      });
      inserted += 1;
    }
    return { inserted };
  });
}
