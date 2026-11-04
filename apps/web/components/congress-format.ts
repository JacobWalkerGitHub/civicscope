import { billLabel, isBillType, senateVotePageUrl } from '@civicscope/core';

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

/**
 * The chamber's own page for a roll call. Senate votes may come from Voteview, which
 * mirrors the Senate's record; the Senate's own page is still the official record.
 */
export function rollCallUrl(v: {
  chamber: 'house' | 'senate';
  congress?: number;
  session?: number;
  votedAt: Date;
  rollNumber: number;
  sourceUrl: string | null;
}): string | null {
  if (v.chamber === 'senate') {
    return v.congress && v.session
      ? senateVotePageUrl(v.congress, v.session, v.rollNumber)
      : v.sourceUrl;
  }
  const year = v.votedAt.toLocaleString('en-US', { year: 'numeric', timeZone: 'America/New_York' });
  return `https://clerk.house.gov/Votes/${year}${v.rollNumber}`;
}

/**
 * Where CivicScope read a vote, when that is not the official record itself (Senate
 * votes read from Voteview): a short name and the link, to cite next to the record.
 */
export function voteDataSource(v: {
  sourceUrl: string | null;
  sourcePublisher?: string | null;
}): { name: string; url: string } | null {
  if (!v.sourceUrl) return null;
  let host: string;
  try {
    host = new URL(v.sourceUrl).hostname;
  } catch {
    return null;
  }
  if (host === 'voteview.com' || host.endsWith('.voteview.com')) {
    return { name: 'Voteview', url: v.sourceUrl };
  }
  return null;
}
