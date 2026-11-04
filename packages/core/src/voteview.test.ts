import { describe, expect, it } from 'vitest';
import {
  readVoteviewCsv,
  VOTEVIEW_COLUMNS,
  voteviewCast,
  voteviewDate,
  voteviewFileUrl,
  voteviewMeasure,
  voteviewParty,
  voteviewRollcallSchema,
  voteviewRollcallUrl,
} from './voteview';

describe('Voteview Senate files', () => {
  it('builds file and page URLs', () => {
    expect(voteviewFileUrl('votes', 119)).toBe(
      'https://voteview.com/static/data/out/votes/S119_votes.csv',
    );
    expect(voteviewRollcallUrl(119, 15)).toBe('https://voteview.com/rollcall/RS1190015');
  });

  it('reads a rollcalls row in the shape Voteview publishes', () => {
    const body = [
      'congress,chamber,rollnumber,date,session,clerk_rollnumber,majority_requirement,yea_count,nay_count,nominate_mid_1,nominate_mid_2,nominate_spread_1,nominate_spread_2,nominate_log_likelihood,bill_number,vote_result,vote_desc,vote_question,dtl_desc',
      '119,Senate,915,2026-09-30,2,256,1/2,47,41,-0.003,-0.232,-0.692,0.456,-0.057,PN1129,Nomination Confirmed,"Keith Sonderling, of Florida, to be Secretary of Labor",On the Nomination,',
    ].join('\n');
    const rows = readVoteviewCsv(body, VOTEVIEW_COLUMNS.rollcalls);
    expect(rows).toHaveLength(1);
    expect(voteviewRollcallSchema.parse(rows[0]!.row)).toMatchObject({
      rollnumber: 915,
      session: 2,
      clerk_rollnumber: 256,
      yea_count: 47,
      bill_number: 'PN1129',
      vote_desc: 'Keith Sonderling, of Florida, to be Secretary of Labor',
    });
  });

  it('names a missing column', () => {
    expect(() => readVoteviewCsv('congress,chamber\n119,Senate', ['icpsr'])).toThrow(
      'missing column icpsr',
    );
    expect(() => readVoteviewCsv('', ['icpsr'])).toThrow('empty');
  });

  it('records cast codes as the Senate tallies them', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(voteviewCast)).toEqual([
      null,
      'Yea',
      'Not Voting',
      'Not Voting',
      'Not Voting',
      'Not Voting',
      'Nay',
      'Present',
      'Present',
      'Not Voting',
    ]);
  });

  it('reads parties, measures and dates', () => {
    expect(['100', '200', '328', '370'].map(voteviewParty)).toEqual(['D', 'R', 'I', '370']);
    expect(voteviewMeasure('SJRES12')).toEqual({ type: 'SJRES', number: '12' });
    expect(voteviewMeasure('PN1129')).toEqual({ type: 'PN', number: '1129' });
    expect(voteviewMeasure(null)).toBeNull();
    expect(voteviewMeasure('Treaty')).toBeNull();
    // Midday in Washington, summer or winter, is the same calendar day there.
    for (const d of ['2025-01-09', '2025-07-16']) {
      const shown = voteviewDate(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      expect(shown).toBe(d);
    }
  });
});
