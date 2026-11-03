import { describe, expect, it } from 'vitest';
import { electionDeadlineInputSchema, electionInputSchema } from '@civicscope/core';
import { CALENDAR_2027 } from './2027';

describe('the reviewed 2027 calendar', () => {
  it('is all valid input, with official https sources', () => {
    for (const e of CALENDAR_2027.elections) {
      expect(electionInputSchema.safeParse({ ...e, jurisdictionId: 1 }).success, e.name).toBe(true);
      expect(new URL(e.officialUrl).hostname).toMatch(/\.(gov|la\.gov|virginia\.gov)$/);
      for (const d of e.deadlines) {
        expect(
          electionDeadlineInputSchema.safeParse({ ...d, electionId: 1 }).success,
          d.label,
        ).toBe(true);
        expect(new URL(d.sourceUrl).hostname).toMatch(/\.gov$/);
        // Every 2027 key date here comes before its election.
        expect(d.date < e.date, `${e.name}: ${d.label}`).toBe(true);
      }
    }
    for (const r of CALENDAR_2027.resources) expect(new URL(r.url).hostname).toMatch(/\.gov$/);
  });

  it('puts each election on the day the official sources give', () => {
    const days = Object.fromEntries(
      CALENDAR_2027.elections.map((e) => [`${e.state} ${e.type}`, e.date]),
    );
    expect(days).toEqual({
      'LA primary': '2027-10-09',
      'LA general': '2027-11-20',
      // Third Tuesday in June; Tuesday after the first Monday in November.
      'VA primary': '2027-06-15',
      'VA general': '2027-11-02',
    });
    const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
    expect(weekday('2027-06-15')).toBe(2);
    expect(weekday('2027-11-02')).toBe(2);
    // Louisiana votes on Saturdays.
    expect(weekday('2027-10-09')).toBe(6);
    expect(weekday('2027-11-20')).toBe(6);
  });
});
