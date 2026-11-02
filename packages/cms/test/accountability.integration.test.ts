import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  CmsError,
  CORRECTION_LIMITS,
  countOpenCorrections,
  getCorrectionRequest,
  listCorrectionRequests,
  listCoverage,
  listPublicCorrections,
  removeCoverage,
  resolveCorrectionRequest,
  setCoverage,
  submitCorrectionRequest,
  type Actor,
} from '../src/index';

/** Fixture values only. */
let test: TestDatabase;
let db: Db;
let actor: Actor;
let kentucky: number;

const request = {
  pagePath: '/candidates/example-person',
  description: 'The filing date shown here does not match the state list.',
  evidenceUrl: 'https://elect.state.example/list',
  contactEmail: 'reader@example.com',
};

async function expectCmsError(promise: Promise<unknown>, match: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(CmsError);
  await expect(promise).rejects.toThrow(match);
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [res] = await db.insert(schema.adminUser).values({
    email: 'owner@test.local',
    name: 'Owner',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.0.0.9' };
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  kentucky = ky!.id;
});
afterAll(async () => {
  await test?.stop();
});

describe('correction requests', () => {
  it('validates what readers send', async () => {
    await expectCmsError(
      submitCorrectionRequest(db, { description: 'short' }, { ipAddress: '203.0.113.1' }),
      /highlighted/,
    );
    await expectCmsError(
      submitCorrectionRequest(
        db,
        { ...request, pagePath: '//evil.example/page' },
        { ipAddress: '203.0.113.1' },
      ),
      /highlighted/,
    );
    await expectCmsError(
      submitCorrectionRequest(
        db,
        { ...request, evidenceUrl: 'javascript:alert(1)' },
        { ipAddress: '203.0.113.1' },
      ),
      /highlighted/,
    );
  });

  it('limits how many one address can send in an hour', async () => {
    for (let i = 0; i < CORRECTION_LIMITS.perAddressPerHour; i += 1) {
      await submitCorrectionRequest(db, request, { ipAddress: '203.0.113.7' });
    }
    await expectCmsError(
      submitCorrectionRequest(db, request, { ipAddress: '203.0.113.7' }),
      /try again later/,
    );
    // Someone else can still send one.
    await submitCorrectionRequest(db, request, { ipAddress: '203.0.113.8' });
    expect(await countOpenCorrections(db)).toBe(CORRECTION_LIMITS.perAddressPerHour + 1);
  });

  it('logs a fix publicly only when an editor writes a public note', async () => {
    const id = await submitCorrectionRequest(
      db,
      { description: 'The party label is wrong for this candidate.' },
      { ipAddress: null },
    );
    expect(await listPublicCorrections(db)).toEqual([]);

    await expectCmsError(
      resolveCorrectionRequest(db, actor, id, { state: 'no_change', publicNote: 'Nothing' }),
      /highlighted/,
    );
    await resolveCorrectionRequest(db, actor, id, { state: 'in_review', internalNote: 'Checking' });
    expect((await getCorrectionRequest(db, id)).resolvedAt).toBeNull();

    await resolveCorrectionRequest(db, actor, id, {
      state: 'fixed',
      internalNote: 'State list confirms it.',
      publicNote: 'Corrected a candidate’s party label.',
    });
    const log = await listPublicCorrections(db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ publicNote: 'Corrected a candidate’s party label.' });
    expect(log[0]!.resolvedAt).toBeInstanceOf(Date);
    expect(Object.keys(log[0]!)).not.toContain('internalNote');

    const resolved = await listCorrectionRequests(db, { open: false });
    expect(resolved.map((r) => r.id)).toEqual([id]);
  });

  it('keeps readers’ emails and addresses out of the audit history', async () => {
    const id = await submitCorrectionRequest(db, request, { ipAddress: '203.0.113.9' });
    await resolveCorrectionRequest(db, actor, id, { state: 'spam' });
    const revisions = await db
      .select()
      .from(schema.revision)
      .where(
        and(
          eq(schema.revision.entityType, 'correction_request'),
          eq(schema.revision.entityId, String(id)),
        ),
      );
    const text = JSON.stringify(revisions);
    expect(text).not.toContain('reader@example.com');
    expect(text).not.toContain('203.0.113.9');
  });
});

describe('coverage', () => {
  it('sets, replaces and removes a row per state, cycle and office level', async () => {
    await expectCmsError(
      setCoverage(db, actor, {
        jurisdictionId: kentucky,
        cycleYear: 2027,
        officeLevel: 'state',
        level: 'complete',
      }),
      /highlighted/,
    );
    const id = await setCoverage(db, actor, {
      jurisdictionId: kentucky,
      cycleYear: 2027,
      officeLevel: 'state',
      level: 'partial',
      note: 'Governor race only.',
    });
    const again = await setCoverage(db, actor, {
      jurisdictionId: kentucky,
      cycleYear: 2027,
      officeLevel: 'state',
      level: 'complete',
      asOf: '2026-11-01',
    });
    expect(again).toBe(id);
    const rows = await listCoverage(db);
    expect(rows).toEqual([
      expect.objectContaining({
        jurisdictionName: 'Kentucky',
        cycleYear: 2027,
        level: 'complete',
        asOf: '2026-11-01',
        note: null,
      }),
    ]);
    await removeCoverage(db, actor, id);
    expect(await listCoverage(db)).toEqual([]);
  });
});
