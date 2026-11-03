import { describe, expect, it } from 'vitest';
import type { CongressMember } from '@civicscope/core';
import { termsInCongress } from './congress-import';

const m = (item: CongressMember['terms']['item']): CongressMember =>
  ({
    bioguideId: 'X000001',
    name: 'Example, Pat',
    state: 'Ohio',
    terms: { item },
  }) as CongressMember;

describe('termsInCongress', () => {
  it('picks the term that falls in the Congress, not the one that ended on January 3', () => {
    expect(
      termsInCongress(
        m([
          { chamber: 'House of Representatives', startYear: 2023, endYear: 2025 },
          { chamber: 'House of Representatives', startYear: 2025, endYear: null },
        ]),
        119,
      ),
    ).toEqual([{ chamber: 'house', startYear: 2025, endYear: null }]);
  });

  it('uses the chamber a member served in during that Congress', () => {
    expect(
      termsInCongress(
        m([
          { chamber: 'House of Representatives', startYear: 2023, endYear: 2025 },
          { chamber: 'Senate', startYear: 2025 },
        ]),
        119,
      ),
    ).toEqual([{ chamber: 'senate', startYear: 2025, endYear: null }]);
    expect(
      termsInCongress(
        m([{ chamber: 'House of Representatives', startYear: 2023, endYear: 2025 }]),
        118,
      ),
    ).toEqual([{ chamber: 'house', startYear: 2023, endYear: 2025 }]);
  });

  it('falls back to a term that ended early in the first year', () => {
    expect(
      termsInCongress(
        m([{ chamber: 'House of Representatives', startYear: 2023, endYear: 2025 }]),
        119,
      ),
    ).toEqual([{ chamber: 'house', startYear: 2023, endYear: 2025 }]);
  });
});
