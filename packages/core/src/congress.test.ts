import { describe, expect, it } from 'vitest';
import {
  billLabel,
  congressGovBillUrl,
  congressYears,
  houseVoteMembersSchema,
  legislatorFullName,
  legislatorSchema,
  legislatorSortName,
  stateCode,
} from './congress';

describe('Congress helpers', () => {
  it('knows which years a Congress sits in', () => {
    expect(congressYears(119)).toEqual([2025, 2026]);
    expect(congressYears(1)).toEqual([1789, 1790]);
  });

  it('builds Congress.gov bill links and labels', () => {
    expect(congressGovBillUrl(119, 'hr', 3424)).toBe(
      'https://www.congress.gov/bill/119th-congress/house-bill/3424',
    );
    expect(congressGovBillUrl(121, 'sjres', 5)).toBe(
      'https://www.congress.gov/bill/121st-congress/senate-joint-resolution/5',
    );
    expect(congressGovBillUrl(112, 'hres', 1)).toContain('/112th-congress/');
    expect(billLabel('hconres', 12)).toBe('H.Con.Res. 12');
  });

  it('maps state and territory names to USPS codes', () => {
    expect(stateCode('Massachusetts')).toBe('MA');
    expect(stateCode('District of Columbia')).toBe('DC');
    expect(stateCode('Northern Mariana Islands')).toBe('MP');
    expect(stateCode('Atlantis')).toBeNull();
  });

  it('names legislators the way Congress does', () => {
    const l = legislatorSchema.parse({
      id: { bioguide: 'X000001', fec: ['H8KY06901'] },
      name: { first: 'Robert', nickname: 'Bobby', last: 'Example', suffix: 'Jr.' },
      terms: [{ type: 'rep', start: '2025-01-03', end: '2027-01-03', state: 'KY', district: 6 }],
    });
    expect(legislatorFullName(l)).toBe('Bobby Example Jr.');
    expect(legislatorSortName(l)).toBe('Example Jr., Bobby');
    expect(
      legislatorFullName({ ...l, name: { ...l.name, official_full: 'Robert B. Example Jr.' } }),
    ).toBe('Robert B. Example Jr.');
  });

  it('accepts a vote for Speaker, where members vote for a name', () => {
    const parsed = houseVoteMembersSchema.safeParse({
      houseRollCallVoteMemberVotes: {
        congress: 119,
        sessionNumber: 1,
        rollCallNumber: 2,
        startDate: '2025-01-03T13:00:00-05:00',
        updateDate: '2025-01-04T00:00:00-05:00',
        results: [{ bioguideID: 'X000001', voteCast: 'Example' }],
      },
    });
    expect(parsed.success).toBe(true);
  });
});
