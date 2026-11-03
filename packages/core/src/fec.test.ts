import { describe, expect, it } from 'vitest';
import { parseCsv, toCsvLine } from './csv';
import {
  fecCandidateListUrl,
  fecCandidatePageSchema,
  fecIdState,
  fecSortName,
  formatFecName,
  generalElectionDate,
} from './fec';

describe('formatFecName', () => {
  it('turns "LAST, FIRST MIDDLE SUFFIX" into a readable name', () => {
    expect(formatFecName('SMITH, JOHN A. JR.')).toBe('John A. Smith Jr.');
    expect(formatFecName('DOE, JANE')).toBe('Jane Doe');
    expect(formatFecName('MCDONALD, MARY-KATE')).toBe('Mary-Kate McDonald');
    expect(formatFecName("O'BRIEN, PAT III")).toBe("Pat O'Brien III");
    expect(formatFecName('VAN DER BERG, ANNA')).toBe('Anna Van Der Berg');
    expect(formatFecName('GARCÍA, JOSÉ')).toBe('José García');
  });

  it('drops honorifics and copes with names without a comma', () => {
    expect(formatFecName('JONES, DR. ALEX MR')).toBe('Alex Jones');
    expect(formatFecName('CHER')).toBe('Cher');
    expect(formatFecName('  LEE ,  KIM  ')).toBe('Kim Lee');
  });
});

describe('fecSortName', () => {
  it('keeps the surname the FEC gives, even when it has several words', () => {
    expect(fecSortName('VAN HOLLEN, CHRIS')).toBe('Van Hollen, Chris');
    expect(fecSortName('CORTEZ MASTO, CATHERINE')).toBe('Cortez Masto, Catherine');
    expect(fecSortName('SMITH, JOHN A. JR.')).toBe('Smith Jr., John A.');
    expect(fecSortName('BOOZMAN, SEN. JOHN')).toBe('Boozman, John');
    expect(fecSortName('CHER')).toBe('Cher');
  });
});

describe('fecIdState', () => {
  it('reads the state from Senate and House IDs only', () => {
    expect(fecIdState('S6MD03441')).toBe('MD');
    expect(fecIdState('H8KY06999')).toBe('KY');
    expect(fecIdState('P80008345')).toBeNull();
  });
});

describe('generalElectionDate', () => {
  it('is the Tuesday after the first Monday in November', () => {
    expect(generalElectionDate(2024)).toBe('2024-11-05');
    expect(generalElectionDate(2026)).toBe('2026-11-03');
    expect(generalElectionDate(2027)).toBe('2027-11-02');
    expect(generalElectionDate(2028)).toBe('2028-11-07');
    // November 1 is a Tuesday: the first Monday is the 7th, so the election is the 8th.
    expect(generalElectionDate(2022)).toBe('2022-11-08');
  });
});

describe('fecCandidateListUrl', () => {
  it('links to the public FEC list for the race', () => {
    expect(fecCandidateListUrl({ office: 'H', cycle: 2028, state: 'KY', district: '06' })).toBe(
      'https://www.fec.gov/data/candidates/house/?election_year=2028&state=KY&district=06',
    );
    expect(fecCandidateListUrl({ office: 'H', cycle: 2028, state: 'AK', district: '00' })).toBe(
      'https://www.fec.gov/data/candidates/house/?election_year=2028&state=AK',
    );
    expect(fecCandidateListUrl({ office: 'P', cycle: 2028, state: 'US' })).toBe(
      'https://www.fec.gov/data/candidates/president/?election_year=2028',
    );
  });
});

describe('fecCandidatePageSchema', () => {
  it('rejects records that are missing what we rely on', () => {
    const base = {
      candidate_id: 'H8KY06999',
      name: 'EXAMPLE, ALEX',
      office: 'H',
      state: 'KY',
      district: '06',
      party: 'DEM',
      incumbent_challenge: 'C',
      candidate_status: 'C',
    };
    const page = (r: object) => ({ results: [r], pagination: { page: 1, pages: 1, count: 1 } });
    expect(fecCandidatePageSchema.safeParse(page(base)).success).toBe(true);
    expect(fecCandidatePageSchema.safeParse(page({ ...base, office: 'X' })).success).toBe(false);
    expect(fecCandidatePageSchema.safeParse(page({ ...base, candidate_id: '12' })).success).toBe(
      false,
    );
  });
});

describe('toCsvLine', () => {
  it('round-trips through the CSV parser', () => {
    const line = toCsvLine(['Smith, John', 'say "hi"', null, 3, true]);
    expect(parseCsv(`${line}\n`)[0]!.cells).toEqual(['Smith, John', 'say "hi"', '', '3', 'true']);
  });
});
