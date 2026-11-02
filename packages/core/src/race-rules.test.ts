import { describe, expect, it } from 'vitest';
import {
  ELECTION_TYPES,
  PRIMARY_SYSTEMS,
  electionInputSchema,
  isValidPrimarySystem,
  racePartyError,
  racePartyRule,
  raceInputSchema,
  validateRaceForElection,
} from './index';

describe('racePartyRule', () => {
  it('requires a party for partisan primaries and conventions', () => {
    expect(racePartyRule('primary', 'closed')).toBe('required');
    expect(racePartyRule('primary_runoff', 'semi_closed')).toBe('required');
    expect(racePartyRule('special_primary', 'open_partisan')).toBe('required');
    expect(racePartyRule('convention', 'closed')).toBe('required');
  });

  it('forbids a party for jungle, top-two and nonpartisan primaries', () => {
    expect(racePartyRule('primary', 'jungle')).toBe('forbidden');
    expect(racePartyRule('primary', 'top_two')).toBe('forbidden');
    expect(racePartyRule('primary', 'nonpartisan')).toBe('forbidden');
  });

  it('forbids a party for every general election type', () => {
    for (const type of [
      'general',
      'general_runoff',
      'special_general',
      'special_runoff',
    ] as const) {
      expect(racePartyRule(type, 'not_applicable')).toBe('forbidden');
    }
  });
});

describe('racePartyError', () => {
  it('explains a missing party in a closed primary', () => {
    expect(racePartyError('primary', 'closed', null)).toMatch(/must name the party/);
  });
  it('explains an unexpected party in a general election', () => {
    expect(racePartyError('general', 'not_applicable', 3)).toMatch(/cannot name one/);
  });
  it('returns null when the race is valid', () => {
    expect(racePartyError('primary', 'closed', 3)).toBeNull();
    expect(racePartyError('general', 'not_applicable', null)).toBeNull();
  });
});

describe('isValidPrimarySystem', () => {
  it('accepts exactly one system class per election type', () => {
    for (const type of ELECTION_TYPES) {
      const valid = PRIMARY_SYSTEMS.filter((s) => isValidPrimarySystem(type, s));
      if (type.includes('general') || type === 'special_runoff') {
        expect(valid).toEqual(['not_applicable']);
      } else {
        expect(valid).not.toContain('not_applicable');
        expect(valid.length).toBe(PRIMARY_SYSTEMS.length - 1);
      }
    }
  });
});

describe('electionInputSchema', () => {
  const base = {
    cycleId: 1,
    jurisdictionId: 18,
    date: '2027-11-02',
    name: 'Kentucky General Election',
  };

  it('accepts a general election with no primary system', () => {
    const parsed = electionInputSchema.parse({
      ...base,
      type: 'general',
      primarySystem: 'not_applicable',
    });
    expect(parsed.publishState).toBe('draft');
  });

  it('rejects a primary without a primary system', () => {
    const result = electionInputSchema.safeParse({
      ...base,
      type: 'primary',
      primarySystem: 'not_applicable',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-HTTPS official URL', () => {
    const result = electionInputSchema.safeParse({
      ...base,
      type: 'general',
      primarySystem: 'not_applicable',
      officialUrl: 'http://elect.example.gov',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date', () => {
    const result = electionInputSchema.safeParse({
      ...base,
      date: '2027-02-30',
      type: 'general',
      primarySystem: 'not_applicable',
    });
    expect(result.success).toBe(false);
  });
});

describe('validateRaceForElection', () => {
  const race = raceInputSchema.parse({ electionId: 1, officeId: 1, name: 'Governor' });

  it('flags a Louisiana-style jungle primary race that names a party', () => {
    const errors = validateRaceForElection(
      { ...race, partyId: 2 },
      { type: 'primary', primarySystem: 'jungle' },
    );
    expect(errors).toHaveLength(1);
  });

  it('passes a jungle primary race with no party', () => {
    expect(validateRaceForElection(race, { type: 'primary', primarySystem: 'jungle' })).toEqual([]);
  });
});
