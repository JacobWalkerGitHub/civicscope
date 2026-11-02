import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  addPersonIdentifier,
  addStatusEvent,
  applyImport,
  CmsError,
  countOpenConflicts,
  createCandidacy,
  createCandidateImport,
  createElection,
  createOffice,
  createParty,
  createPerson,
  createRace,
  discardImport,
  getCandidacy,
  listCitations,
  listLocks,
  listOpenConflicts,
  listStatusEvents,
  previewImport,
  resolveConflict,
  unlockField,
  updateCandidacy,
} from '../src/index';

/** Fixture values only: not real candidates or real election data. */
let test: TestDatabase;
let db: Db;
let actor: { userId: number; ipAddress: string };
let raceId: number;
let primaryRaceId: number;
let partyA: number;
let partyB: number;

const source = {
  sourceUrl: 'https://elect.state.example/2027/candidates.csv',
  sourceTitle: 'Candidate filings (example)',
  sourcePublisher: 'State Board of Elections (example)',
  sourceType: 'official_election_authority',
};

async function expectCmsError(promise: Promise<unknown>, match: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(CmsError);
  await expect(promise).rejects.toThrow(match);
}

async function upload(csvText: string, race = raceId, extra: Record<string, unknown> = {}) {
  return createCandidateImport(db, actor, {
    ...source,
    raceId: String(race),
    fileName: 'candidates.csv',
    csvText,
    ...extra,
  });
}

async function plan(id: number) {
  const p = (await previewImport(db, id)).plan!;
  return p;
}

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  await seedJurisdictions(db);
  const [ky] = await db
    .select()
    .from(schema.jurisdiction)
    .where(eq(schema.jurisdiction.uspsCode, 'KY'));
  const [res] = await db.insert(schema.adminUser).values({
    email: 'importer@test.local',
    name: 'Test Importer',
    passwordHash: 'x',
    role: 'owner',
  });
  actor = { userId: res.insertId, ipAddress: '10.1.1.3' };
  partyA = await createParty(db, actor, { name: 'Example Party A', shortName: 'EPA' });
  partyB = await createParty(db, actor, { name: 'Example Party B' });
  const officeId = await createOffice(db, actor, {
    jurisdictionId: String(ky!.id),
    title: 'Example Commissioner',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const electionId = await createElection(db, actor, {
    jurisdictionId: String(ky!.id),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example general',
  });
  raceId = await createRace(db, actor, { electionId, officeId, name: 'Example Commissioner' });
  const primaryId = await createElection(db, actor, {
    jurisdictionId: String(ky!.id),
    type: 'primary',
    primarySystem: 'closed',
    date: '2027-05-18',
    name: 'Example primary',
  });
  primaryRaceId = await createRace(db, actor, {
    electionId: primaryId,
    officeId,
    partyId: partyA,
    name: 'Example Commissioner (Party A)',
  });
});
afterAll(async () => {
  await test?.stop();
});

describe('upload checks', () => {
  it('rejects files that are not usable CSV before storing anything', async () => {
    await expectCmsError(upload(''), /Choose a CSV file/);
    await expectCmsError(upload('\n\n'), /empty/);
    await expectCmsError(upload('full_name\n'), /no rows/);
    await expectCmsError(upload('name,party\nA,B'), /Unknown column: "name"/);
    await expectCmsError(upload('ballot_name\nA'), /needs a full_name column/);
    await expectCmsError(upload('full_name,full_name\nA,B'), /appears twice/);
    await expectCmsError(upload('full_name\n"Open'), /not valid CSV/);
  });

  it('needs title, publisher and type for a source it has not seen', async () => {
    await expectCmsError(
      upload('full_name\nA Person', raceId, {
        sourceTitle: '',
        sourceUrl: 'https://new.example/x',
      }),
      /not a known source/,
    );
  });
});

describe('preview', () => {
  it('validates every row and names the column at fault', async () => {
    const id = await upload(
      [
        'Full Name,Party,Status,Status Date,Incumbent,Campaign URL,FEC Candidate ID',
        'Avery Sample,Example Party A,filed,2026-01-15,no,https://avery.example,',
        'B,,filed,,maybe,http://insecure.example,X1',
        'Casey Sample,Nonexistent Party,,,,,',
        'Avery Sample,EPA,,,,,',
        'Dana Sample,,banana,2026-01-01,,,',
        'Eli Sample,,filed,,,,',
      ].join('\n'),
    );
    const p = await plan(id);
    expect(p.fileErrors).toEqual([]);
    const [avery, b, casey, averyAgain, dana, eli] = p.rows;
    expect(avery).toMatchObject({ line: 2, action: 'create', errors: [] });
    expect(avery!.changes.map((c) => c.field)).toEqual([
      'ballotName',
      'partyId',
      'campaignUrl',
      'status',
    ]);
    expect(b!.action).toBe('error');
    expect(b!.errors.join(' ')).toMatch(/full_name: A full name must be at least 2/);
    expect(b!.errors.join(' ')).toMatch(/incumbent: Use yes or no/);
    expect(b!.errors.join(' ')).toMatch(/campaign_url: Enter a full https/);
    expect(b!.errors.join(' ')).toMatch(/fec_candidate_id/);
    expect(casey!.errors.join(' ')).toMatch(/no party called "Nonexistent Party"/);
    expect(averyAgain!.errors.join(' ')).toMatch(/already on line 2/);
    expect(dana!.errors.join(' ')).toMatch(/status: Use one of/);
    expect(eli!.errors).toEqual(['status_date: Give the date of this status.']);
    expect(p.counts).toMatchObject({ create: 1, error: 5 });
    await expectCmsError(applyImport(db, actor, id), /Fix the rows with errors/);
    await discardImport(db, actor, id);
    await expectCmsError(applyImport(db, actor, id), /already discarded/);
  });

  it('flags a possible duplicate person instead of guessing', async () => {
    const existing = await createPerson(db, actor, { fullName: 'Robin Lookalike' });
    const id = await upload('full_name\nRobin  Lookalike');
    const [row] = (await plan(id)).rows;
    expect(row!.errors[0]).toMatch(
      new RegExp(`Possible duplicate of Robin Lookalike \\(${existing}\\)`),
    );

    const linked = await upload(`full_name,person_id\nRobin Lookalike,${existing}`);
    expect((await plan(linked)).rows[0]).toMatchObject({
      action: 'add_to_race',
      personId: existing,
    });
    const separate = await upload('full_name,person_id\nRobin Lookalike,new');
    expect((await plan(separate)).rows[0]).toMatchObject({ action: 'create', personId: null });
    await discardImport(db, actor, id);
    await discardImport(db, actor, linked);
    await discardImport(db, actor, separate);
  });

  it('matches by FEC candidate ID first', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Morgan Federal' });
    await addPersonIdentifier(db, actor, pid, { scheme: 'fec_candidate_id', value: 'H0KY01234' });
    const id = await upload('full_name,fec_candidate_id\nMorgan R. Federal,h0ky01234');
    expect((await plan(id)).rows[0]).toMatchObject({
      action: 'add_to_race',
      personId: pid,
      addFecId: null,
    });
    const wrong = await upload(`full_name,fec_candidate_id,person_id\nX Y,H0KY01234,999999`);
    expect((await plan(wrong)).rows[0]!.errors.join(' ')).toMatch(/no person 999999/);
    await discardImport(db, actor, id);
    await discardImport(db, actor, wrong);
  });

  it('gives a partisan primary’s candidates the primary’s party', async () => {
    const id = await upload(
      'full_name,party\nPrim Ary,\nOther Side,Example Party B',
      primaryRaceId,
    );
    const [ok, bad] = (await plan(id)).rows;
    expect(ok).toMatchObject({ action: 'create', partyId: partyA });
    expect(bad!.errors.join(' ')).toMatch(/one party’s primary/);
    await discardImport(db, actor, id);
  });
});

describe('apply', () => {
  let jordanCandidacy: number;

  it('writes every row in one audited, cited batch; new records are drafts', async () => {
    const id = await upload(
      [
        'full_name,ballot_name,party,status,status_date,incumbent,fec_candidate_id',
        'Jordan Import,Jordan "JI" Import,Example Party A,filed,2026-02-01,yes,H6KY05678',
        'Taylor Import,,,announced,2026-01-10,,',
      ].join('\n'),
    );
    const summary = await applyImport(db, actor, id);
    expect(summary).toMatchObject({ create: 2, error: 0, conflicts: 0 });

    const [jordan] = await db
      .select()
      .from(schema.person)
      .where(eq(schema.person.fullName, 'Jordan Import'));
    expect(jordan!.publishState).toBe('draft');
    const [c] = await db
      .select()
      .from(schema.candidacy)
      .where(and(eq(schema.candidacy.personId, jordan!.id), eq(schema.candidacy.raceId, raceId)));
    jordanCandidacy = c!.id;
    expect(c).toMatchObject({
      ballotName: 'Jordan "JI" Import',
      partyId: partyA,
      isIncumbent: true,
      status: 'filed',
      statusDate: '2026-02-01',
      publishState: 'draft',
    });
    const ids = await db
      .select()
      .from(schema.personIdentifier)
      .where(eq(schema.personIdentifier.personId, jordan!.id));
    expect(ids.map((i) => i.value)).toEqual(['H6KY05678']);

    // Every imported record is cited to the file's source.
    const personCites = await listCitations(db, 'person', jordan!.id);
    expect(personCites.map((x) => x.sourceUrl)).toEqual([source.sourceUrl]);
    const candidacyCites = await listCitations(db, 'candidacy', c!.id);
    expect(candidacyCites.map((x) => x.field).sort()).toEqual([null, 'status']);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, 'import_batch'));
    expect(audit.some((a) => a.action === 'import' && a.entityId === String(id))).toBe(true);
    const preview = await previewImport(db, id);
    expect(preview.batch.state).toBe('applied');
    expect(preview.plan).toBeNull();
    await expectCmsError(applyImport(db, actor, id), /already applied/);
  });

  it('a second run of the same file changes nothing', async () => {
    const id = await upload(
      [
        'full_name,ballot_name,party,status,status_date,incumbent',
        'Jordan Import,Jordan "JI" Import,Example Party A,filed,2026-02-01,yes',
      ].join('\n'),
    );
    expect((await plan(id)).rows[0]).toMatchObject({ action: 'unchanged', changes: [] });
    expect(await applyImport(db, actor, id)).toMatchObject({ unchanged: 1 });
  });

  it('is all or nothing: a failure part-way leaves no rows behind', async () => {
    const before = await db.select().from(schema.person);
    const id = await upload('full_name\nFirst Okay\nSecond Fails');
    // Force the second row's candidacy insert to fail after the first row is written.
    await db.execute(
      sql.raw(`CREATE TRIGGER test_fail_import BEFORE INSERT ON candidacy FOR EACH ROW
        BEGIN IF NEW.ballot_name = 'Second Fails' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced failure'; END IF; END`),
    );
    try {
      await expect(applyImport(db, actor, id)).rejects.toThrow();
    } finally {
      await db.execute(sql.raw('DROP TRIGGER test_fail_import'));
    }
    expect(await db.select().from(schema.person)).toHaveLength(before.length);
    expect((await previewImport(db, id)).batch.state).toBe('preview');
    await discardImport(db, actor, id);
  });

  it('updates unlocked fields and skips statuses older than the recorded one', async () => {
    const id = await upload(
      [
        'full_name,campaign_url,status,status_date',
        'Jordan Import,https://jordan.example,announced,2025-12-01',
      ].join('\n'),
    );
    const [row] = (await plan(id)).rows;
    expect(row!.action).toBe('update');
    expect(row!.changes).toEqual([
      { field: 'campaignUrl', from: null, to: 'https://jordan.example', locked: false },
    ]);
    expect(row!.warnings[0]).toMatch(/older than the recorded "filed"/);
    await applyImport(db, actor, id);
    expect((await getCandidacy(db, jordanCandidacy)).campaignUrl).toBe('https://jordan.example');
  });

  it('never overwrites a field changed by hand: it opens a conflict instead', async () => {
    const current = await getCandidacy(db, jordanCandidacy);
    await updateCandidacy(db, actor, jordanCandidacy, {
      partyId: String(current.partyId),
      ballotName: 'Jordan Import',
      isIncumbent: 'on',
      campaignUrl: current.campaignUrl ?? '',
    });
    const locks = await listLocks(db, 'candidacy', jordanCandidacy);
    expect(locks.map((l) => l.field)).toEqual(['ballotName']);

    const csv = 'full_name,ballot_name,party\nJordan Import,Jordan "JI" Import,Example Party B';
    const id = await upload(csv);
    const [row] = (await plan(id)).rows;
    expect(row!.changes).toEqual([
      { field: 'ballotName', from: 'Jordan Import', to: 'Jordan "JI" Import', locked: true },
      { field: 'partyId', from: partyA, to: partyB, locked: false },
    ]);
    expect(await applyImport(db, actor, id)).toMatchObject({ update: 1, conflicts: 1 });
    const after = await getCandidacy(db, jordanCandidacy);
    expect(after.ballotName).toBe('Jordan Import');
    expect(after.partyId).toBe(partyB);
    expect(await countOpenConflicts(db)).toBe(1);

    // The same file again doesn't pile up duplicate conflicts.
    const again = await upload(csv);
    expect(await applyImport(db, actor, again)).toMatchObject({ conflicts: 0 });
    expect(await countOpenConflicts(db)).toBe(1);

    // Keeping the current value leaves the lock in place.
    const [conflict] = await listOpenConflicts(db);
    expect(conflict).toMatchObject({
      field: 'ballotName',
      currentValue: 'Jordan Import',
      proposedValue: 'Jordan "JI" Import',
      sourceUrl: source.sourceUrl,
    });
    await resolveConflict(db, actor, conflict!.id, 'reject', 'Hand edit is right');
    await expectCmsError(resolveConflict(db, actor, conflict!.id, 'accept'), /already settled/);
    expect(await countOpenConflicts(db)).toBe(0);
    expect((await listLocks(db, 'candidacy', jordanCandidacy)).map((l) => l.field)).toEqual([
      'ballotName',
    ]);
  });

  it('accepting a conflict writes the source’s value and lifts the lock', async () => {
    await addStatusEvent(db, actor, jordanCandidacy, {
      ...source,
      status: 'qualified',
      effectiveDate: '2026-03-01',
    });
    expect((await listLocks(db, 'candidacy', jordanCandidacy)).map((l) => l.field)).toEqual([
      'ballotName',
      'status',
    ]);
    const id = await upload('full_name,status,status_date\nJordan Import,withdrawn,2026-04-01');
    expect(await applyImport(db, actor, id)).toMatchObject({ conflicts: 1 });
    expect((await getCandidacy(db, jordanCandidacy)).status).toBe('qualified');

    const [conflict] = await listOpenConflicts(db);
    await resolveConflict(db, actor, conflict!.id, 'accept');
    const c = await getCandidacy(db, jordanCandidacy);
    expect(c).toMatchObject({ status: 'withdrawn', statusDate: '2026-04-01' });
    expect((await listStatusEvents(db, jordanCandidacy))[0]!.status).toBe('withdrawn');
    expect((await listLocks(db, 'candidacy', jordanCandidacy)).map((l) => l.field)).toEqual([
      'ballotName',
    ]);
  });

  it('unlocking lets the next import update the field', async () => {
    const [lock] = await listLocks(db, 'candidacy', jordanCandidacy);
    await unlockField(db, actor, lock!.id);
    const id = await upload('full_name,ballot_name\nJordan Import,Jordan "JI" Import');
    expect(await applyImport(db, actor, id)).toMatchObject({ update: 1, conflicts: 0 });
    expect((await getCandidacy(db, jordanCandidacy)).ballotName).toBe('Jordan "JI" Import');
  });

  it('adds an existing person who is not yet in the race', async () => {
    const pid = await createPerson(db, actor, { fullName: 'Quinn Existing' });
    const other = await createPerson(db, actor, { fullName: 'Rowan Elsewhere' });
    await createCandidacy(db, actor, { personId: String(other), raceId: String(primaryRaceId) });
    const id = await upload(`full_name,person_id\nQuinn Existing,${pid}`);
    expect(await applyImport(db, actor, id)).toMatchObject({ add_to_race: 1 });
    const [c] = await db
      .select()
      .from(schema.candidacy)
      .where(and(eq(schema.candidacy.personId, pid), eq(schema.candidacy.raceId, raceId)));
    expect(c!.ballotName).toBe('Quinn Existing');
  });
});
