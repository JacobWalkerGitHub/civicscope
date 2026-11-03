import { describe, expect, it } from 'vitest';
import type { CongressMember } from '@civicscope/core';
import { billUpToDate, termsInCongress } from './congress-import';

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

describe('billUpToDate', () => {
  const stored = (sourceUpdatedAt: string, checked: string | null) => ({
    sourceUpdatedAt,
    sourceCheckedAt: checked ? new Date(checked) : null,
  });

  it('skips a bill fetched after the listed date ended', () => {
    expect(billUpToDate(stored('2025-01-14T09:05:19Z', '2026-11-03T01:00:00Z'), '2025-01-14')).toBe(
      true,
    );
    // An evening change in Eastern time is the next day in UTC.
    expect(billUpToDate(stored('2025-01-15T02:00:00Z', '2026-11-03T01:00:00Z'), '2025-01-14')).toBe(
      true,
    );
  });

  it('fetches a bill whose listed date is newer than the stored stamp', () => {
    expect(billUpToDate(stored('2025-01-14T09:05:19Z', '2026-11-03T01:00:00Z'), '2025-01-15')).toBe(
      false,
    );
  });

  it('fetches again a bill last fetched on the day it changed', () => {
    expect(billUpToDate(stored('2025-01-14T09:05:19Z', '2025-01-14T10:00:00Z'), '2025-01-14')).toBe(
      false,
    );
    expect(billUpToDate(stored('2025-01-14T09:05:19Z', null), '2025-01-14')).toBe(false);
  });

  it('accepts an exact stamp match', () => {
    expect(billUpToDate(stored('2025-01-14T09:05:19Z', null), '2025-01-14T09:05:19Z')).toBe(true);
  });
});
