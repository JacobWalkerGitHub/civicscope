import { CA_COUNTIES, NC_COUNTIES, type FeedKind } from './parse';

export interface ResultFeedConfig {
  state: string;
  electionDate: string;
  kind: FeedKind;
  /** The machine-readable file the state publishes for election night. */
  url: string;
  /** The state's own results page, linked next to every number we show. */
  publicUrl: string;
  /** More files read with the main one, for states that publish one per race. */
  parts?: string[];
  /** Per-county files, numbered 1..n in this order. */
  counties?: {
    names: string[];
    url: (n: number, name: string) => string;
    /** For a state whose county files cover one race only, that race's ID. */
    race?: string;
  };
}

/*
 * Official results files, checked by hand. Only files a state publishes for anyone to
 * download are listed; a site that blocks automated readers is left out, not worked
 * around. Minnesota and California added
 * the same night. Checked 2026-11-03: Pennsylvania and Arizona refuse automated requests, Texas
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
    counties: {
      names: NC_COUNTIES,
      url: (n) => `https://er.ncsbe.gov/enr/20261103/data/results_${n}.txt`,
    },
  },
  {
    state: 'FL',
    electionDate: '2026-11-03',
    kind: 'fl-dos',
    url: 'https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt',
    publicUrl: 'https://results.elections.myflorida.com/',
  },
];

const CA = 'https://api.sos.ca.gov/returns';
const CA_STATEWIDE = [
  'lieutenant-governor',
  'secretary-of-state',
  'controller',
  'treasurer',
  'attorney-general',
  'insurance-commissioner',
  'superintendent-of-public-instruction',
  'ballot-measures',
];
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

RESULT_FEEDS.push(
  {
    state: 'MN',
    electionDate: '2026-11-03',
    kind: 'mn-sos',
    // Every race, by county, in one file.
    url: 'https://electionresultsfiles.sos.mn.gov/20261103/allracesbycounty.txt',
    publicUrl: 'https://electionresults.sos.mn.gov/',
  },
  {
    state: 'CA',
    electionDate: '2026-11-03',
    kind: 'ca-sos',
    url: `${CA}/governor`,
    // Statewide offices, measures and the U.S. House; the legislature is left out to
    // keep each read to about 120 requests.
    parts: [
      ...CA_STATEWIDE.map((r) => `${CA}/${r}`),
      ...range(52).map((d) => `${CA}/us-rep/district/${d}`),
    ],
    publicUrl: 'https://electionresults.sos.ca.gov/',
    counties: {
      names: CA_COUNTIES,
      url: (_n, name) => `${CA}/governor/county/${name.toLowerCase().replace(/\s+/g, '-')}`,
      race: 'governor',
    },
  },
);

/** Feeds are read from noon UTC on election day until this many days after it. */
export const FEED_ACTIVE_DAYS = 10;

/** The feeds to read now: from election day until counting has long settled. */
export function activeFeeds(now = new Date(), feeds = RESULT_FEEDS): ResultFeedConfig[] {
  return feeds.filter((f) => {
    const start = Date.parse(`${f.electionDate}T12:00:00Z`);
    return now.getTime() >= start && now.getTime() < start + FEED_ACTIVE_DAYS * 86_400_000;
  });
}
