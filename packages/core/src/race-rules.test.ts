import { describe, expect, it } from 'vitest';
import {
  ELECTION_TYPES,
  PRIMARY_SYSTEMS,
  electionInputSchema,
  fieldErrors,
  isValidPrimarySystem,
  officeInputSchema,
  partyInputSchema,
  slugify,
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
  const base = { jurisdictionId: '18', date: '2027-11-02', name: 'Kentucky General Election' };

  it('accepts a general election with no primary system and coerces form strings', () => {
    const parsed = electionInputSchema.parse({
      ...base,
      type: 'general',
      primarySystem: 'not_applicable',
      officialUrl: '',
    });
    expect(parsed.jurisdictionId).toBe(18);
    expect(parsed.officialUrl).toBeNull();
  });

  it('rejects a primary without a primary system', () => {
    const result = electionInputSchema.safeParse({
      ...base,
      type: 'primary',
      primarySystem: 'not_applicable',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).primarySystem).toMatch(/must say/);
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

describe('raceInputSchema and validateRaceForElection', () => {
  const race = raceInputSchema.parse({
    electionId: '1',
    officeId: '1',
    districtId: '',
    partyId: '',
    name: 'Governor',
  });

  it('turns blank selects into null and unchecked boxes into false', () => {
    expect(race).toMatchObject({ districtId: null, partyId: null, isSpecial: false, seats: 1 });
  });

  it('flags a Louisiana-style jungle primary race that names a party', () => {
    const errors = validateRaceForElection(
      { partyId: 2 },
      { type: 'primary', primarySystem: 'jungle' },
    );
    expect(errors).toHaveLength(1);
  });

  it('passes a jungle primary race with no party', () => {
    expect(validateRaceForElection(race, { type: 'primary', primarySystem: 'jungle' })).toEqual([]);
  });
});

describe('officeInputSchema', () => {
  it('rejects a chamber on a non-legislative office', () => {
    const result = officeInputSchema.safeParse({
      jurisdictionId: '1',
      title: 'Governor of Kentucky',
      level: 'state',
      branch: 'executive',
      chamber: 'upper',
    });
    expect(result.success).toBe(false);
  });

  it('reads an unchecked partisan box as false', () => {
    const parsed = officeInputSchema.parse({
      jurisdictionId: '1',
      title: 'Judge',
      level: 'state',
      branch: 'judicial',
    });
    expect(parsed.isPartisan).toBe(false);
  });
});

describe('partyInputSchema', () => {
  it('uppercases FEC codes and validates them', () => {
    expect(partyInputSchema.parse({ name: 'Test Party', fecCode: 'tst' }).fecCode).toBe('TST');
    expect(partyInputSchema.safeParse({ name: 'Test Party', fecCode: 'TOOLONG' }).success).toBe(
      false,
    );
  });

  it('accepts the FEC’s shorter codes for unaffiliated and write-in', () => {
    expect(partyInputSchema.parse({ name: 'Unaffiliated', fecCode: 'un' }).fecCode).toBe('UN');
    expect(partyInputSchema.parse({ name: 'Write-in', fecCode: 'W' }).fecCode).toBe('W');
    expect(partyInputSchema.safeParse({ name: 'Test Party', fecCode: 'D1' }).success).toBe(false);
  });
});

describe('slugify', () => {
  it('makes URL-safe slugs', () => {
    expect(slugify('Governor of Kentucky')).toBe('governor-of-kentucky');
    expect(slugify('  Virginia House of Delegates — District 7 ')).toBe(
      'virginia-house-of-delegates-district-7',
    );
    expect(slugify('Peña & Sons')).toBe('pena-and-sons');
  });
});
