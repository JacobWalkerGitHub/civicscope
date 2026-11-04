import { describe, expect, it } from 'vitest';
import { activeFeeds, RESULT_FEEDS } from './feeds';
import { parseFlDos, parseNcsbe } from './parse';

const nc = JSON.stringify([
  {
    gid: '1383',
    cnm: 'US SENATE (VOTE FOR 1)',
    vfr: '1',
    bnm: 'Roy Cooper',
    pty: 'DEM',
    vct: '1200',
    prt: '10',
    ptl: '2626',
    ogl: 'FED',
  },
  {
    gid: '1383',
    cnm: 'US SENATE (VOTE FOR 1)',
    vfr: '1',
    bnm: 'Michael Whatley',
    pty: 'REP',
    vct: '1,300',
    prt: '10',
    ptl: '2626',
    ogl: 'FED',
  },
  {
    gid: '9',
    cnm: 'CITY OF RALEIGH CITY COUNCIL AT-LARGE (VOTE FOR 2)',
    vfr: '2',
    bnm: 'A Person',
    pty: '',
    vct: '5',
    prt: '1',
    ptl: '111',
    ogl: 'CCL',
  },
  {
    gid: '7',
    cnm: 'CONSTITUTIONAL AMENDMENT - REQUIRE PHOTO ID FOR VOTING',
    vfr: '1',
    bnm: 'For',
    pty: '',
    vct: '0',
    prt: '0',
    ptl: '2626',
    ogl: '',
  },
  {
    gid: '2',
    cnm: 'NC STATE SENATE DISTRICT 10 (VOTE FOR 1)',
    vfr: '1',
    bnm: 'B Person',
    pty: 'REP',
    vct: '0',
    prt: '0',
    ptl: '40',
    ogl: 'NCS',
  },
]);

const fl = [
  'ElectionDate\tPartyCode\tPartyName\tRaceCode\tRaceName\tCountyCode\tCountyName\tJuris1num\tJuris2num\tPrecincts\tPrecinctsReporting\tCanNameLast\tCanNameFirst\tCanNameMiddle\tCanVotes',
  '11/03/2026\tREP\tRepublican Party\tGOV\tGovernor and Lieutenant Governor\tALA\tAlachua\t   \t \t63\t20\tDoe\tJane\t\t100',
  '11/03/2026\tDEM\tDemocratic Party\tGOV\tGovernor and Lieutenant Governor\tALA\tAlachua\t   \t \t63\t20\tRoe\tRichard\tQ\t150',
  '11/03/2026\tREP\tRepublican Party\tGOV\tGovernor and Lieutenant Governor\tBAK\tBaker\t   \t \t9\t9\tDoe\tJane\t\t70',
  '11/03/2026\tDEM\tDemocratic Party\tGOV\tGovernor and Lieutenant Governor\tBAK\tBaker\t   \t \t9\t9\tRoe\tRichard\tQ\t30',
  '11/03/2026\tREP\tRepublican Party\tUSR\tRepresentative in Congress, District 2\tBAK\tBaker\t002\t \t9\t9\tSmith\tAl\t\t40',
  '11/03/2026\tNOP\tNon-Partisan\tAMD\tBudget Stabilization Fund\tBAK\tBaker\t\t\t9\t9\tYes for Approval\t\t\t60',
  '11/03/2026\tNOP\tNon-Partisan\tAMD\tAnother Amendment\tBAK\tBaker\t\t\t9\t9\tYes for Approval\t\t\t10',
].join('\r\n');

describe('parseNcsbe', () => {
  it('groups rows into contests with statewide totals', () => {
    const contests = parseNcsbe(nc);
    expect(contests.map((c) => [c.name, c.group])).toEqual([
      ['US Senate', 'federal'],
      ['NC State Senate District 10', 'legislature'],
      ['Constitutional Amendment - Require Photo ID for Voting', 'measure'],
      ['City of Raleigh City Council At-Large', 'local'],
    ]);
    const senate = contests[0]!;
    expect(senate).toMatchObject({ voteFor: 1, precinctsTotal: 2626, precinctsReporting: 10 });
    expect(senate.candidates.map((c) => [c.name, c.party, c.votes])).toEqual([
      ['Roy Cooper', 'DEM', 1200],
      ['Michael Whatley', 'REP', 1300],
    ]);
    expect(contests[3]!.voteFor).toBe(2);
  });

  it('rejects a file that is not a list', () => {
    expect(() => parseNcsbe('{"error":1}')).toThrow(/JSON array/);
  });
});

describe('parseFlDos', () => {
  it('sums counties into statewide totals and keeps each county', () => {
    const contests = parseFlDos(fl);
    expect(contests.map((c) => c.name)).toEqual([
      'Representative in Congress, District 2',
      'Governor and Lieutenant Governor',
      'Another Amendment',
      'Budget Stabilization Fund',
    ]);
    const gov = contests[1]!;
    expect(gov).toMatchObject({ group: 'statewide', precinctsTotal: 72, precinctsReporting: 29 });
    expect(gov.candidates.map((c) => [c.name, c.party, c.votes])).toEqual([
      ['Jane Doe', 'REP', 170],
      ['Richard Q Roe', 'DEM', 180],
    ]);
    expect(gov.areas.map((a) => [a.name, a.precinctsReporting, Object.values(a.votes)])).toEqual([
      ['Alachua', 20, [100, 150]],
      ['Baker', 9, [70, 30]],
    ]);
    // Measures share a race code; each is its own contest, with no party on "Yes".
    expect(contests[3]!.candidates[0]).toMatchObject({ name: 'Yes for Approval', party: null });
  });

  it('names missing columns', () => {
    expect(() => parseFlDos('ElectionDate\tRaceCode\n')).toThrow(/missing column/);
  });
});

describe('activeFeeds', () => {
  it('reads files from election day until counting settles', () => {
    expect(activeFeeds(new Date('2026-11-02T12:00:00Z'))).toEqual([]);
    expect(activeFeeds(new Date('2026-11-04T01:00:00Z'))).toEqual(RESULT_FEEDS);
    expect(activeFeeds(new Date('2026-12-01T00:00:00Z'))).toEqual([]);
  });
});
