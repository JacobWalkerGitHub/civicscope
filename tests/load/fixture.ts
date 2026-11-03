/**
 * Starts a throwaway MySQL with fictional published data for a local load test, and
 * prints its DATABASE_URL. Keeps running until Ctrl-C.
 *   pnpm exec tsx tests/load/fixture.ts [--races 12] [--candidates 8]
 * Fictional names and example.* URLs only: never load this into a real database.
 */
import { parseArgs } from 'node:util';
import {
  addCitation,
  addStatusEvent,
  approveClaim,
  createCandidacy,
  createClaim,
  createElection,
  createOffice,
  createPerson,
  createRace,
  setCandidacyPublishState,
  setPersonPublishState,
  setPublishState,
  submitClaimForReview,
} from '@civicscope/cms';
import { schema, seedIssues, seedJurisdictions } from '@civicscope/db';
import { startTestDatabase } from '@civicscope/db/testing';

const { values } = parseArgs({
  options: {
    races: { type: 'string', default: '12' },
    candidates: { type: 'string', default: '8' },
  },
});
const test = await startTestDatabase();
const db = test.db;
await seedJurisdictions(db);
await seedIssues(db);
const [res] = await db
  .insert(schema.adminUser)
  .values({ email: 'load@test.local', name: 'Load', passwordHash: 'x', role: 'owner' });
const owner = { userId: res.insertId, ipAddress: null };
const ky = (await db.select().from(schema.jurisdiction)).find((j) => j.uspsCode === 'KY');
const issues = await db.select().from(schema.issue);
const src = {
  sourceUrl: 'https://elections.example.gov/load/list',
  sourceTitle: 'Load test list (fictional)',
  sourcePublisher: 'Example Board of Elections',
  sourceType: 'official_election_authority',
};
const electionId = await createElection(db, owner, {
  jurisdictionId: String(ky!.id),
  type: 'general',
  primarySystem: 'not_applicable',
  date: '2027-11-02',
  name: 'Load test general 2027',
});
await setPublishState(db, owner, 'election', electionId, 'published');
for (let r = 1; r <= Number(values.races); r++) {
  const officeId = await createOffice(db, owner, {
    jurisdictionId: String(ky!.id),
    title: `Example Office ${r}`,
    level: 'state',
    branch: 'executive',
    isPartisan: 'on',
  });
  const raceId = await createRace(db, owner, { electionId, officeId, name: `Example Office ${r}` });
  await setPublishState(db, owner, 'race', raceId, 'published');
  for (let c = 1; c <= Number(values.candidates); c++) {
    const personId = await createPerson(db, owner, { fullName: `Load Person ${r}-${c}` });
    await addCitation(db, owner, { ...src, subjectType: 'person', subjectId: String(personId) });
    await setPersonPublishState(db, owner, personId, 'published');
    const cand = await createCandidacy(db, owner, {
      personId: String(personId),
      raceId: String(raceId),
    });
    await addStatusEvent(db, owner, cand, { ...src, status: 'filed', effectiveDate: '2026-03-01' });
    await setCandidacyPublishState(db, owner, cand, 'published');
    for (const issue of issues.slice(0, 3)) {
      const claimId = await createClaim(db, owner, {
        personId: String(personId),
        kind: 'position',
        contentKind: 'candidate_claim',
        title: `Example position on ${issue.name}`,
        summary: 'A fictional position used only for load testing.',
        quote: 'Fictional quote.',
        issueId: String(issue.id),
        positionType: 'stated_position',
      });
      await addCitation(db, owner, { ...src, subjectType: 'claim', subjectId: String(claimId) });
      await submitClaimForReview(db, owner, claimId);
      await approveClaim(db, owner, claimId, 'Fixture');
    }
  }
}
console.log(`DATABASE_URL=${test.url}`);
console.log('Ready. Press Ctrl-C to stop and delete the database.');
process.on('SIGINT', () => void test.stop().then(() => process.exit(0)));
process.on('SIGTERM', () => void test.stop().then(() => process.exit(0)));
setInterval(() => {}, 1 << 30);
