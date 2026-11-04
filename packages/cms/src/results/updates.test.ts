import { describe, expect, it } from 'vitest';
import { addCountyAreas, parseNcsbe } from './parse';
import { describeUpdates, type ContestSnapshot } from './updates';

const snap = (over: Partial<ContestSnapshot> & { a: number; b: number; rep: number }) => {
  const { a, b, rep, ...rest } = over;
  return {
    id: 1,
    name: 'Governor',
    group: 'statewide' as const,
    precinctsTotal: 100,
    precinctsReporting: rep,
    totalVotes: a + b,
    candidates: [
      { name: 'Ann Able', votes: a },
      { name: 'Bob Baker', votes: b },
    ],
    ...rest,
  };
};

describe('describeUpdates', () => {
  it('notes first votes, quarter milestones, lead changes and all precincts in', () => {
    expect(
      describeUpdates('FL', [snap({ a: 0, b: 0, rep: 0 })], [snap({ a: 60, b: 40, rep: 10 })]),
    ).toEqual([
      {
        contestId: 1,
        kind: 'first_votes',
        text: 'FL Governor: first votes in. Ann Able leads Bob Baker by 20.0 points, 10% of precincts reporting.',
      },
    ]);
    expect(
      describeUpdates(
        'FL',
        [snap({ a: 60, b: 40, rep: 10 })],
        [snap({ a: 120, b: 100, rep: 30 })],
      )[0],
    ).toMatchObject({ kind: 'milestone' });
    expect(
      describeUpdates(
        'FL',
        [snap({ a: 120, b: 100, rep: 30 })],
        [snap({ a: 130, b: 150, rep: 35 })],
      )[0],
    ).toMatchObject({
      kind: 'lead_change',
      text: expect.stringContaining('Bob Baker leads Ann Able'),
    });
    expect(
      describeUpdates(
        'FL',
        [snap({ a: 130, b: 150, rep: 90 })],
        [snap({ a: 140, b: 160, rep: 100 })],
      )[0],
    ).toMatchObject({ kind: 'all_in' });
    // Nothing worth a line, and local contests are left out.
    expect(
      describeUpdates('FL', [snap({ a: 1, b: 2, rep: 30 })], [snap({ a: 2, b: 3, rep: 31 })]),
    ).toEqual([]);
    expect(
      describeUpdates(
        'FL',
        [snap({ a: 0, b: 0, rep: 0, group: 'local' })],
        [snap({ a: 5, b: 1, rep: 5, group: 'local' })],
      ),
    ).toEqual([]);
  });
});

describe('addCountyAreas', () => {
  it('attaches each county file to the statewide contest with the same ID', () => {
    const row = (vct: string, bnm: string, prt: string, ptl: string) => ({
      gid: '1383',
      cnm: 'US SENATE (VOTE FOR 1)',
      vfr: '1',
      bnm,
      pty: bnm === 'A' ? 'DEM' : 'REP',
      vct,
      prt,
      ptl,
      ogl: 'FED',
    });
    const contests = parseNcsbe(
      JSON.stringify([row('10', 'A', '1', '10'), row('5', 'B', '1', '10')]),
    );
    addCountyAreas(contests, [
      {
        code: '2',
        name: 'Alexander',
        body: JSON.stringify([row('3', 'A', '1', '4'), row('2', 'B', '1', '4')]),
      },
      {
        code: '1',
        name: 'Alamance',
        body: JSON.stringify([row('7', 'A', '0', '6'), row('3', 'B', '0', '6')]),
      },
    ]);
    expect(contests[0]!.areas).toEqual([
      {
        code: '1',
        name: 'Alamance',
        precinctsTotal: 6,
        precinctsReporting: 0,
        votes: { 'A|DEM': 7, 'B|REP': 3 },
      },
      {
        code: '2',
        name: 'Alexander',
        precinctsTotal: 4,
        precinctsReporting: 1,
        votes: { 'A|DEM': 3, 'B|REP': 2 },
      },
    ]);
  });
});
