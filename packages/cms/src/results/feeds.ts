import type { FeedKind } from './parse';

export interface ResultFeedConfig {
  state: string;
  electionDate: string;
  kind: FeedKind;
  /** The machine-readable file the state publishes for election night. */
  url: string;
  /** The state's own results page, linked next to every number we show. */
  publicUrl: string;
}

/*
 * Official results files, checked by hand. Only files a state publishes for anyone to
 * download are listed; a site that blocks automated readers is left out, not worked
 * around. Checked 2026-11-03: Pennsylvania and Arizona refuse automated requests, Texas
 * and Georgia publish through pages that need a browser, and Ohio and Michigan did not
 * answer in time.
 */
export const RESULT_FEEDS: ResultFeedConfig[] = [
  {
    state: 'NC',
    electionDate: '2026-11-03',
    kind: 'ncsbe',
    url: 'https://er.ncsbe.gov/enr/20261103/data/results_0.txt',
    publicUrl: 'https://er.ncsbe.gov/?election_dt=11/03/2026&county_id=0&office=FED&contest=0',
  },
  {
    state: 'FL',
    electionDate: '2026-11-03',
    kind: 'fl-dos',
    url: 'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt',
    publicUrl: 'https://results.elections.myflorida.com/',
  },
];

/** Feeds are read from noon UTC on election day until this many days after it. */
export const FEED_ACTIVE_DAYS = 10;

/** The feeds to read now: from election day until counting has long settled. */
export function activeFeeds(now = new Date(), feeds = RESULT_FEEDS): ResultFeedConfig[] {
  return feeds.filter((f) => {
    const start = Date.parse(`${f.electionDate}T12:00:00Z`);
    return now.getTime() >= start && now.getTime() < start + FEED_ACTIVE_DAYS * 86_400_000;
  });
}
