import { describe, expect, it } from 'vitest';
import {
  candidacyInputSchema,
  personIdentifierInputSchema,
  personInputSchema,
  statusEventInputSchema,
} from './schemas';
import { defaultSortName, normalizeSourceUrl, sourceTier } from './sources';

describe('sources', () => {
  it('ranks official records above news above campaign material', () => {
    expect(sourceTier('official_election_authority')).toBe(1);
    expect(sourceTier('court_record')).toBe(1);
    expect(sourceTier('news')).toBe(2);
    expect(sourceTier('campaign_site')).toBe(3);
    expect(sourceTier('other')).toBe(4);
  });

  it('normalizes URLs so one document is stored once', () => {
    expect(normalizeSourceUrl(' https://ELECT.ky.gov/Candidates?y=2027#top ')).toBe(
      'https://elect.ky.gov/Candidates?y=2027',
    );
    expect(normalizeSourceUrl('https://example.gov')).toBe('https://example.gov/');
  });

  it('builds sort names, keeping suffixes with the surname', () => {
    expect(defaultSortName('Jane Q. Public')).toBe('Public, Jane Q.');
    expect(defaultSortName('John Smith Jr.')).toBe('Smith Jr., John');
    expect(defaultSortName('Cher')).toBe('Cher');
  });
});

describe('candidate input', () => {
  it('rejects implausible birth years', () => {
    expect(personInputSchema.safeParse({ fullName: 'A Person', birthYear: '1850' }).success).toBe(
      false,
    );
    expect(personInputSchema.parse({ fullName: 'A Person', birthYear: '' }).birthYear).toBeNull();
  });

  it('checks the shape of FEC, Bioguide and Wikidata IDs', () => {
    expect(
      personIdentifierInputSchema.parse({ scheme: 'fec_candidate_id', value: ' h8va07094 ' }).value,
    ).toBe('H8VA07094');
    expect(
      personIdentifierInputSchema.safeParse({ scheme: 'fec_candidate_id', value: '12345' }).success,
    ).toBe(false);
    expect(
      personIdentifierInputSchema.safeParse({ scheme: 'openstates', value: 'ocd-person/abc' })
        .success,
    ).toBe(true);
  });

  it('checks FEC committee IDs', () => {
    const base = { personId: '1', raceId: '1' };
    expect(candidacyInputSchema.safeParse({ ...base, fecCommitteeId: 'C00123456' }).success).toBe(
      true,
    );
    expect(candidacyInputSchema.safeParse({ ...base, fecCommitteeId: 'X1' }).success).toBe(false);
  });

  it('requires a source and refuses future status dates', () => {
    const ok = {
      status: 'filed',
      effectiveDate: '2025-06-01',
      sourceUrl: 'https://elect.ky.gov/list',
    };
    expect(statusEventInputSchema.safeParse(ok).success).toBe(true);
    expect(statusEventInputSchema.safeParse({ ...ok, sourceUrl: '' }).success).toBe(false);
    expect(statusEventInputSchema.safeParse({ ...ok, effectiveDate: '2999-01-01' }).success).toBe(
      false,
    );
  });
});
