import { describe, expect, it } from 'vitest';
import { RESULT_FEEDS } from './feeds';
import { parseFeed } from './ingest';
import { addCaCountyAreas, parseCaSos, parseMnSos } from './parse';

describe('parseMnSos', () => {
  it('sums statewide contests across counties and keeps county offices apart', () => {
    const rows = [
      'MN;01;;0102;U.S. Senator;;0403;Pat One;;;DFL;10;51;300;0;0',
      'MN;01;;0102;U.S. Senator;;0303;Sam Two;;;R;10;51;200;0;0',
      'MN;02;;0102;U.S. Senator;;0403;Pat One;;;DFL;5;100;50;0;0',
      'MN;02;;0102;U.S. Senator;;0303;Sam Two;;;R;5;100;150;0;0',
      'MN;01;;0391;County Commissioner District 1;01;9001;Ann A;;;NP;1;2;7;0;0',
      'MN;02;;0391;County Commissioner District 1;01;9001;Bea B;;;NP;1;3;9;0;0',
    ].join('\n');
    const contests = parseMnSos([rows]);
    const senate = contests.find((c) => c.name === 'U.S. Senator')!;
    expect(senate).toMatchObject({ group: 'federal', precinctsTotal: 151, precinctsReporting: 15 });
    expect(senate.candidates.map((c) => [c.name, c.party, c.votes])).toEqual([
      ['Pat One', 'DFL', 350],
      ['Sam Two', 'R', 350],
    ]);
    expect(senate.areas.map((a) => a.name)).toEqual(['Aitkin', 'Anoka']);
    const local = contests.filter((c) => c.group === 'local');
    expect(local).toHaveLength(2);
    expect(local.every((c) => c.areas.length === 0 && c.candidates[0]!.party === null)).toBe(true);
  });
});

describe('parseCaSos', () => {
  const race = (title: string, votes: [string, string, string][], rep = '1.0% (20 of 2,000)') =>
    JSON.stringify({
      raceTitle: title,
      Reporting: `${rep} precincts reporting`,
      candidates: votes.map(([Name, Party, Votes]) => ({ Name, Party, Votes })),
    });

  it('reads offices, House districts, measures and one race by county', () => {
    const contests = parseCaSos([
      {
        path: 'governor',
        body: race('Governor - Statewide Results', [
          ['A Able', 'Dem', '1,000'],
          ['B Baker', 'Rep', '900'],
        ]),
      },
      {
        path: 'us-rep/district/1',
        body: race('U.S. House of Representatives District 1 - Districtwide Results', [
          ['C', 'Rep', '5'],
        ]),
      },
      {
        path: 'ballot-measures',
        body: JSON.stringify({
          raceTitle: 'Ballot Measures - Statewide Results',
          Reporting: '1.0% (20 of 2,000) precincts reporting',
          'ballot-measures': [{ Name: 'Bonds.', Number: '01', yesVotes: '10', noVotes: '4' }],
        }),
      },
    ]);
    expect(contests.map((c) => [c.sourceKey, c.name, c.group])).toEqual([
      ['us-rep/district/1', 'U.S. House of Representatives District 1', 'federal'],
      ['governor', 'Governor', 'statewide'],
      ['ballot-measures/01', 'Proposition 1: Bonds.', 'measure'],
    ]);
    expect(contests[1]).toMatchObject({ precinctsTotal: 2000, precinctsReporting: 20 });
    addCaCountyAreas(contests, 'governor', [
      {
        code: '1',
        name: 'Alameda',
        body: `[${race(
          'Governor - Alameda County Results',
          [
            ['A Able', 'Dem', '70'],
            ['B Baker', 'Rep', '30'],
          ],
          '5.0% (3 of 60)',
        )},${race('Governor - Statewide Results', [])}]`,
      },
    ]);
    expect(contests[1]!.areas).toEqual([
      {
        code: '1',
        name: 'Alameda',
        precinctsTotal: 60,
        precinctsReporting: 3,
        votes: { 'A Able|Dem': 70, 'B Baker|Rep': 30 },
      },
    ]);
  });

  it('builds the county file names California uses', () => {
    const ca = RESULT_FEEDS.find((f) => f.state === 'CA')!;
    expect(ca.counties!.url(19, 'Los Angeles')).toBe(
      'https://api.sos.ca.gov/returns/governor/county/los-angeles',
    );
    expect(
      parseFeed(ca, race('Governor - Statewide Results', [['A', 'Dem', '1']]), [], [])[0]!
        .sourceKey,
    ).toBe('governor');
  });
});
