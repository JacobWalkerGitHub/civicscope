import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, seedJurisdictions, type Db } from '@civicscope/db';
import { startTestDatabase, type TestDatabase } from '@civicscope/db/testing';
import {
  CALENDAR_2027,
  CmsError,
  loadCalendar,
  createDeadline,
  createElection,
  createOffice,
  createRace,
  createResource,
  getPublicElection,
  listDeadlines,
  listPublicElections,
  listPublicElectionYears,
  listResources,
  markResourceChecked,
  removeDeadline,
  setArchived,
  setPublishState,
  setResourceArchived,
  updateDeadline,
  updateResource,
  type Actor,
} from '../src/index';

/** Fixture values only: these are not real election dates or official pages. */
let test: TestDatabase;
let db: Db;
let owner: Actor;
let ky: number;
let la: number;
const ids = {} as Record<string, number>;
const SOURCE = 'https://elections.state.example/2027-calendar.pdf';

const audits = async (entityType: string, entityId: number) =>
  db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.entityType, entityType),
        eq(schema.auditLog.entityId, String(entityId)),
      ),
    );

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
  owner = { userId: res.insertId, ipAddress: null };
  const state = async (code: string) =>
    (
      await db
        .select({ id: schema.jurisdiction.id })
        .from(schema.jurisdiction)
        .where(eq(schema.jurisdiction.uspsCode, code))
    )[0]!.id;
  ky = await state('KY');
  la = await state('LA');

  ids.primary = await createElection(db, owner, {
    jurisdictionId: String(la),
    type: 'primary',
    primarySystem: 'jungle',
    date: '2027-10-09',
    name: 'Example jungle primary 2027',
  });
  ids.general = await createElection(db, owner, {
    jurisdictionId: String(la),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-20',
    name: 'Example general 2027',
    officialUrl: 'https://elections.state.example/2027',
  });
  ids.draft = await createElection(db, owner, {
    jurisdictionId: String(ky),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2027-11-02',
    name: 'Example draft election',
  });
  ids.past = await createElection(db, owner, {
    jurisdictionId: String(ky),
    type: 'general',
    primarySystem: 'not_applicable',
    date: '2025-11-04',
    name: 'Example past election',
  });
  for (const e of [ids.primary, ids.general, ids.past]) {
    await setPublishState(db, owner, 'election', e!, 'published');
  }
  const officeId = await createOffice(db, owner, {
    jurisdictionId: String(la),
    title: 'Example Governor',
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  ids.race = await createRace(db, owner, {
    electionId: ids.primary,
    officeId,
    name: 'Example Governor primary',
  });
  ids.draftRace = await createRace(db, owner, {
    electionId: ids.general,
    officeId,
    name: 'Example Governor general',
  });
  await setPublishState(db, owner, 'race', ids.race!, 'published');
});
afterAll(async () => {
  await test?.stop();
});

describe('election key dates', () => {
  it('adds a sourced date to an election and records it', async () => {
    ids.filing = await createDeadline(db, owner, {
      electionId: String(ids.primary),
      kind: 'filing_close',
      date: '2027-08-05',
      label: 'Last day of qualifying (example)',
      sourceUrl: SOURCE,
    });
    ids.registration = await createDeadline(db, owner, {
      electionId: String(ids.primary),
      kind: 'voter_registration',
      date: '2027-09-08',
      label: 'In-person and by-mail registration ends (example)',
      sourceUrl: SOURCE,
    });
    expect((await listDeadlines(db, ids.primary!)).map((d) => d.kind)).toEqual([
      'filing_close',
      'voter_registration',
    ]);
    expect(await audits('election_deadline', ids.filing)).toHaveLength(1);
  });

  it('refuses a date with no official source, or a source that is not https', async () => {
    const base = {
      electionId: String(ids.primary),
      kind: 'early_voting_start',
      date: '2027-09-25',
      label: 'Early voting begins (example)',
    };
    await expect(createDeadline(db, owner, base)).rejects.toThrow(CmsError);
    await expect(
      createDeadline(db, owner, { ...base, sourceUrl: 'http://elections.state.example/' }),
    ).rejects.toMatchObject({ fieldErrors: { sourceUrl: expect.any(String) } });
  });

  it('refuses a date far from the election, which is almost always a wrong year', async () => {
    await expect(
      createDeadline(db, owner, {
        electionId: String(ids.primary),
        kind: 'filing_close',
        date: '2017-08-05',
        label: 'Typo year (example)',
        sourceUrl: SOURCE,
      }),
    ).rejects.toMatchObject({ fieldErrors: { date: expect.any(String) } });
  });

  it('edits a date without moving it to another election, and removes it with a record', async () => {
    await updateDeadline(db, owner, ids.registration!, {
      electionId: String(ids.general),
      kind: 'voter_registration',
      date: '2027-09-09',
      label: 'Registration ends (example, corrected)',
      sourceUrl: SOURCE,
    });
    const [d] = await db
      .select()
      .from(schema.electionDeadline)
      .where(eq(schema.electionDeadline.id, ids.registration!));
    expect(d).toMatchObject({ electionId: ids.primary, date: '2027-09-09' });

    const extra = await createDeadline(db, owner, {
      electionId: String(ids.primary),
      kind: 'other',
      date: '2027-09-01',
      label: 'Entered by mistake (example)',
      sourceUrl: SOURCE,
    });
    await removeDeadline(db, owner, extra);
    expect((await listDeadlines(db, ids.primary!)).map((d) => d.id)).not.toContain(extra);
    expect((await audits('election_deadline', extra)).map((a) => a.action)).toEqual([
      'create',
      'delete',
    ]);
  });

  it('does not add dates to an archived election', async () => {
    const archivedId = await createElection(db, owner, {
      jurisdictionId: String(ky),
      type: 'general',
      primarySystem: 'not_applicable',
      date: '2027-11-03',
      name: 'Example archived election',
    });
    await setArchived(db, owner, 'election', archivedId, true);
    await expect(
      createDeadline(db, owner, {
        electionId: String(archivedId),
        kind: 'other',
        date: '2027-10-01',
        label: 'Should not be added',
        sourceUrl: SOURCE,
      }),
    ).rejects.toThrow(/archived/);
  });
});

describe('official links', () => {
  it('adds, edits, checks and archives a state’s official links', async () => {
    ids.office = await createResource(db, owner, {
      jurisdictionId: String(la),
      kind: 'election_authority',
      label: 'Example Secretary of State, Elections',
      url: 'https://elections.state.example/',
    });
    await expect(
      createResource(db, owner, {
        jurisdictionId: String(la),
        kind: 'other',
        label: 'Same link again',
        url: 'https://elections.state.example/',
      }),
    ).rejects.toThrow(/already has that link/);
    await expect(
      createResource(db, owner, {
        jurisdictionId: String(la),
        kind: 'other',
        label: 'Not secure',
        url: 'http://elections.state.example/other',
      }),
    ).rejects.toMatchObject({ fieldErrors: { url: expect.any(String) } });

    await updateResource(db, owner, ids.office!, {
      jurisdictionId: String(ky),
      kind: 'election_authority',
      label: 'Example Secretary of State',
      url: 'https://elections.state.example/',
    });
    const [r] = await listResources(db, la);
    expect(r).toMatchObject({ label: 'Example Secretary of State', jurisdictionId: la });
    expect(r!.lastCheckedAt).toBeInstanceOf(Date);
    await markResourceChecked(db, owner, ids.office!);

    ids.oldLink = await createResource(db, owner, {
      jurisdictionId: String(la),
      kind: 'results',
      label: 'Old results page (example)',
      url: 'https://elections.state.example/old-results',
    });
    await setResourceArchived(db, owner, ids.oldLink, true);
    expect((await listResources(db, la)).map((x) => x.id)).toEqual([ids.office]);
    expect(await listResources(db, la, { includeArchived: true })).toHaveLength(2);
  });
});

describe('public calendar', () => {
  it('lists only published upcoming elections, with their dates and covered races', async () => {
    const list = await listPublicElections(db, { from: '2026-11-03' });
    expect(list.map((e) => e.name)).toEqual([
      'Example jungle primary 2027',
      'Example general 2027',
    ]);
    expect(list[0]!.deadlines.map((d) => d.kind)).toEqual(['filing_close', 'voter_registration']);
    // The draft race in the general election is not counted.
    expect(list.map((e) => e.raceCount)).toEqual([1, 0]);
    expect(await listPublicElectionYears(db)).toEqual([2027, 2025]);
    expect((await listPublicElections(db, { year: 2025 })).map((e) => e.name)).toEqual([
      'Example past election',
    ]);
    // An admin preview also shows the draft.
    const preview = await listPublicElections(db, { from: '2026-11-03', preview: true });
    expect(preview.map((e) => e.name)).toContain('Example draft election');
  });

  it('shows one election with its dates, public races, sibling elections and live links', async () => {
    const page = (await getPublicElection(db, ids.primary!))!;
    expect(page.election).toMatchObject({ primarySystem: 'jungle', jurisdictionName: 'Louisiana' });
    expect(page.deadlines).toHaveLength(2);
    expect(page.races.map((r) => r.name)).toEqual(['Example Governor primary']);
    expect(page.related.map((r) => r.name)).toEqual(['Example general 2027']);
    expect(page.resources.map((r) => r.label)).toEqual(['Example Secretary of State']);

    expect(await getPublicElection(db, ids.draft!)).toBeNull();
    expect(await getPublicElection(db, ids.draft!, { preview: true })).not.toBeNull();
  });
});

describe('the reviewed 2027 calendar file', () => {
  it('loads as drafts with every date and link, and changes nothing when loaded again', async () => {
    // This database already has fixture Louisiana elections on the two 2027 Louisiana
    // dates: the file's dates and links attach to those instead of duplicating them.
    const first = await loadCalendar(db, owner, CALENDAR_2027);
    expect(first).toMatchObject({
      electionsCreated: 2,
      electionsExisting: 2,
      deadlinesCreated: 16,
      resourcesCreated: 7,
      differences: [],
    });
    const revisions = (await db.select().from(schema.revision)).length;
    const again = await loadCalendar(db, owner, CALENDAR_2027);
    expect(again).toMatchObject({
      electionsCreated: 0,
      electionsExisting: 4,
      deadlinesCreated: 0,
      deadlinesExisting: 16,
      resourcesCreated: 0,
      resourcesExisting: 7,
    });
    expect((await db.select().from(schema.revision)).length).toBe(revisions);

    const [va] = await db
      .select()
      .from(schema.election)
      .where(eq(schema.election.name, 'Virginia Primary Elections 2027'));
    expect(va).toMatchObject({
      publishState: 'draft',
      primarySystem: 'open_partisan',
      date: '2027-06-15',
    });
    // Drafts: not on the public calendar until a reviewer publishes them.
    expect((await listPublicElections(db, { year: 2027 })).map((e) => e.name)).not.toContain(
      'Virginia Primary Elections 2027',
    );
    expect((await listDeadlines(db, ids.primary!)).map((d) => d.label)).toContain(
      'Candidate qualifying ends',
    );
  });

  it('reports a date an editor has since changed instead of overwriting it', async () => {
    await db
      .update(schema.electionDeadline)
      .set({ date: '2027-08-06' })
      .where(eq(schema.electionDeadline.label, 'Candidate qualifying ends'));
    const s = await loadCalendar(db, owner, CALENDAR_2027);
    expect(s.differences).toEqual([expect.stringContaining('Candidate qualifying ends')]);
    const [d] = await db
      .select()
      .from(schema.electionDeadline)
      .where(eq(schema.electionDeadline.label, 'Candidate qualifying ends'));
    expect(d!.date).toBe('2027-08-06');
  });
});
