import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseSenateDateTime,
  parseSenateXml,
  senateVoteMeasure,
  senateVoteMenuSchema,
  senateVotePageUrl,
  senateVoteSchema,
  senateVoteXmlUrl,
  senateVoteMenuUrl,
} from './senate';

// Real files from senate.gov (119th Congress, session 1), saved as published.
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/senate/${name}`, import.meta.url), 'utf8');

describe('Senate vote files', () => {
  it('builds senate.gov URLs', () => {
    expect(senateVoteMenuUrl(119, 1)).toBe(
      'https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_1.xml',
    );
    expect(senateVoteXmlUrl(119, 1, 8)).toBe(
      'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00008.xml',
    );
    expect(senateVotePageUrl(119, 2, 518)).toBe(
      'https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00518.htm',
    );
  });

  it('reads the vote menu', () => {
    const menu = senateVoteMenuSchema.parse(parseSenateXml(fixture('vote_menu_119_1.xml')));
    expect(menu.vote_summary).toMatchObject({ congress: 119, session: 1, congress_year: 2025 });
    expect(menu.vote_summary.votes.map((v) => v.vote_number)).toEqual([659, 648, 632]);
  });

  it('reads a menu for a session with no votes yet', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><vote_summary><congress>120</congress><session>1</session><congress_year>2027</congress_year><votes/></vote_summary>';
    expect(senateVoteMenuSchema.parse(parseSenateXml(xml)).vote_summary.votes).toEqual([]);
  });

  it('reads a vote with every senator', () => {
    const { roll_call_vote: v } = senateVoteSchema.parse(
      parseSenateXml(fixture('vote_119_1_00518.xml')),
    );
    expect(v).toMatchObject({ congress: 119, session: 1, vote_number: 518 });
    expect(v.question).toBe('On the Cloture Motion');
    expect(v.vote_result).toBe('Cloture Motion Agreed to');
    expect(v.members.member).toHaveLength(100);
    expect(v.members.member[0]).toMatchObject({
      lis_member_id: 'S428',
      last_name: 'Alsobrooks',
      party: 'D',
      state: 'MD',
      vote_cast: 'Nay',
    });
    const casts = v.members.member.map((m) => m.vote_cast);
    expect(casts.filter((c) => c === 'Yea')).toHaveLength(50);
    expect(casts.filter((c) => c === 'Nay')).toHaveLength(44);
    expect(casts.filter((c) => c === 'Not Voting')).toHaveLength(6);
    expect(senateVoteMeasure(v)).toEqual({ type: 'PN', number: '464' });
    // Empty elements come back as null, not "".
    expect(v.tie_breaker).toEqual(expect.objectContaining({ by_whom: null }));
  });

  it('names the amendment when a vote is on one', () => {
    const xml = fixture('vote_119_1_00518.xml').replace(
      '<amendment_number/>',
      '<amendment_number>S.Amdt. 1</amendment_number>',
    );
    const { roll_call_vote: v } = senateVoteSchema.parse(parseSenateXml(xml));
    expect(senateVoteMeasure(v)).toEqual({ type: 'S.Amdt.', number: '1' });
  });

  it('rejects a file whose members have no LIS ID', () => {
    const xml = fixture('vote_119_1_00008.xml').replace(
      '<lis_member_id>S428</lis_member_id>',
      '<lis_member_id></lis_member_id>',
    );
    expect(senateVoteSchema.safeParse(parseSenateXml(xml)).success).toBe(false);
    // An error page instead of a vote file parses, but is not a vote.
    const page = parseSenateXml('<html><body><h1>Page not found</h1></body></html>');
    expect(senateVoteSchema.safeParse(page).success).toBe(false);
    expect(() => parseSenateXml('{"json": true}')).toThrow();
  });

  it('reads Senate times as Eastern time', () => {
    // Daylight time (UTC-4) in September, standard time (UTC-5) in January.
    expect(parseSenateDateTime('September 15, 2025,  06:15 PM')?.toISOString()).toBe(
      '2025-09-15T22:15:00.000Z',
    );
    expect(parseSenateDateTime('January 20, 2025,  06:35 PM')?.toISOString()).toBe(
      '2025-01-20T23:35:00.000Z',
    );
    expect(parseSenateDateTime('March 9, 2025, 12:05 AM')?.toISOString()).toBe(
      '2025-03-09T05:05:00.000Z',
    );
    expect(parseSenateDateTime('November 2, 2025, 01:30 PM')?.toISOString()).toBe(
      '2025-11-02T18:30:00.000Z',
    );
    expect(parseSenateDateTime('18-Dec')).toBeNull();
  });
});
