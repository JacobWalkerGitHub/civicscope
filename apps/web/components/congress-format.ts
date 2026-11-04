import { billLabel, isBillType } from '@civicscope/core';

/** Votes are dated where Congress sits. */
export const voteDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'America/New_York',
});

/**
 * The measure a roll call was on: "H.R. 3424" from the Clerk's "HR" or the Senate's
 * "H.R."; nominations ("PN") and amendments as the chamber names them.
 */
export function voteMeasure(v: {
  legislationType: string | null;
  legislationNumber: string | null;
}): string | null {
  if (!v.legislationNumber) return null;
  const type = v.legislationType?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return isBillType(type) && /^\d+$/.test(v.legislationNumber)
    ? billLabel(type, Number(v.legislationNumber))
    : `${v.legislationType} ${v.legislationNumber}`;
}

/** The chamber's own page for a roll call. */
export function rollCallUrl(v: {
  chamber: 'house' | 'senate';
  votedAt: Date;
  rollNumber: number;
  sourceUrl: string | null;
}): string | null {
  if (v.chamber === 'senate') return v.sourceUrl;
  const year = v.votedAt.toLocaleString('en-US', { year: 'numeric', timeZone: 'America/New_York' });
  return `https://clerk.house.gov/Votes/${year}${v.rollNumber}`;
}
