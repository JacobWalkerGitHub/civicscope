import { describe, expect, it } from 'vitest';
import { governorFromFile, officialLink, parseLegislatorCsv } from './state-officials';

// Made-up rows in the shape of Open States' files; not real officeholders.
const CSV = [
  'id,name,current_party,current_district,current_chamber,given_name,family_name,links,sources',
  'ocd-person/a-1,Pat Example,Democratic,22,upper,Pat,Example,https://ballotpedia.org/x;https://senate.example.gov/S1,https://ballotpedia.org/x',
  'ocd-person/a-2,"Robin ""Rob"" Newname",Republican,Fairfax-3,lower,,,https://www.caucus.com/rob,https://house.example.us/H2',
  'ocd-person/a-3,No Chamber,Independent,4,,,,,',
  'not-an-id,Bad Row,Independent,4,lower,,,,',
  'ocd-person/a-4,Sam Senate,Nonpartisan,5,legislature,Sam,Senate,https://nebraskalegislature.gov/d5,',
].join('\n');

describe('parseLegislatorCsv', () => {
  it('reads legislators and skips rows without an ID or chamber', () => {
    const rows = parseLegislatorCsv('VA', CSV);
    expect(rows).toEqual([
      {
        osPersonId: 'ocd-person/a-1',
        state: 'VA',
        role: 'upper',
        district: '22',
        name: 'Pat Example',
        sortName: 'Example, Pat',
        partyName: 'Democratic',
        officialUrl: 'https://senate.example.gov/S1',
        termStart: null,
        termEnd: null,
      },
      expect.objectContaining({
        osPersonId: 'ocd-person/a-2',
        role: 'lower',
        district: 'Fairfax-3',
        name: 'Robin "Rob" Newname',
        sortName: 'Robin "Rob" Newname',
        // The caucus site is passed over for the state's own.
        officialUrl: 'https://house.example.us/H2',
      }),
      expect.objectContaining({ osPersonId: 'ocd-person/a-4', role: 'legislature' }),
    ]);
  });

  it('refuses a file without the columns it needs', () => {
    expect(() => parseLegislatorCsv('VA', 'name,party\nPat,D')).toThrow(/no "id" column/);
  });
});

describe('officialLink', () => {
  it('takes only state government sites', () => {
    expect(officialLink(['https://en.wikipedia.org/x', 'https://www.senate.mn/members/1'])).toBe(
      'https://www.senate.mn/members/1',
    );
    expect(officialLink(['https://example.com', 'ftp://x.gov/', null])).toBeNull();
  });
});

const yamlFile = (roles: string) => `id: ocd-person/g-1
name: Alex Governor
given_name: Alex
family_name: Governor
party:
- name: Independent
roles:
${roles}
links:
- url: https://www.governor.example.gov/
sources:
- url: https://ballotpedia.org/Alex_Governor
`;

describe('governorFromFile', () => {
  const role = (start: string, end: string, state = 'va', type = 'governor') =>
    `- start_date: '${start}'\n  end_date: '${end}'\n  type: ${type}\n  jurisdiction: ocd-jurisdiction/country:us/state:${state}/government`;

  it('finds a governor whose term includes today', () => {
    const text = yamlFile(
      [role('2018-01-13', '2022-01-15'), role('2026-01-17', '2030-01-17')].join('\n'),
    );
    expect(governorFromFile('VA', text, '2026-11-04')).toEqual({
      osPersonId: 'ocd-person/g-1',
      state: 'VA',
      role: 'governor',
      district: null,
      name: 'Alex Governor',
      sortName: 'Governor, Alex',
      partyName: 'Independent',
      officialUrl: 'https://www.governor.example.gov/',
      termStart: '2026-01-17',
      termEnd: '2030-01-17',
    });
  });

  it('skips past and future governors, other offices and other states', () => {
    for (const r of [
      role('2019-01-07', '2023-01-02'),
      role('2027-01-04', '2031-01-04'),
      role('2026-01-17', '2030-01-17', 'va', 'lt_governor'),
      role('2026-01-17', '2030-01-17', 'md'),
    ]) {
      expect(governorFromFile('VA', yamlFile(r), '2026-11-04')).toBeNull();
    }
  });

  it('counts the day a term ends as over', () => {
    expect(
      governorFromFile('VA', yamlFile(role('2022-01-15', '2026-11-04')), '2026-11-04'),
    ).toBeNull();
  });
});
