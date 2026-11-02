import { describe, expect, it } from 'vitest';
import { STATES, stateOcdId } from './states';

describe('STATES seed data', () => {
  it('has the 50 states plus DC', () => {
    expect(STATES).toHaveLength(51);
    expect(STATES.filter((s) => s.usps === 'DC')).toHaveLength(1);
  });

  it('has unique, well-formed codes', () => {
    expect(new Set(STATES.map((s) => s.usps)).size).toBe(51);
    expect(new Set(STATES.map((s) => s.fips)).size).toBe(51);
    for (const s of STATES) {
      expect(s.usps).toMatch(/^[A-Z]{2}$/);
      expect(s.fips).toMatch(/^\d{2}$/);
      expect(s.ansi).toMatch(/^\d{8}$/);
    }
  });

  it('builds Open Civic Data IDs', () => {
    expect(stateOcdId('KY')).toBe('ocd-division/country:us/state:ky');
    expect(stateOcdId('DC')).toBe('ocd-division/country:us/district:dc');
  });
});
