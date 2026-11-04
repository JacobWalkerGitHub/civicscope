import { describe, expect, it } from 'vitest';
import { mergeSeats } from './compare-record';

describe('mergeSeats', () => {
  it('joins terms in the same seat and keeps a current term open', () => {
    const term = (
      congress: number,
      start: number,
      end: number | null,
      district: number | null = 7,
    ) => ({
      chamber: 'house' as const,
      state: 'VA',
      district,
      startYear: start,
      endYear: end,
      congress,
    });
    expect(
      mergeSeats([
        term(119, 2025, null),
        term(118, 2023, 2025),
        { ...term(117, 2021, 2023), chamber: 'senate' as const, district: null },
      ]),
    ).toEqual([
      { chamber: 'house', state: 'VA', district: '7', startYear: 2023, endYear: null },
      { chamber: 'senate', state: 'VA', district: null, startYear: 2021, endYear: 2023 },
    ]);
  });

  it('keeps different districts apart', () => {
    const seats = mergeSeats([
      { chamber: 'house', state: 'NC', district: 1, startYear: 2019, endYear: 2023 },
      { chamber: 'house', state: 'NC', district: 2, startYear: 2023, endYear: null },
    ]);
    expect(seats.map((s) => s.district)).toEqual(['2', '1']);
  });
});
