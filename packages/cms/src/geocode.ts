/*
 * Address to districts, through the US Census Bureau's public geocoder
 * (geocoding.geo.census.gov). No key and no account. The address is sent to the Census
 * Bureau to look it up and is not stored or logged by CivicScope.
 */

const STATE_FIPS: Record<string, string> = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
};

export interface AddressDistricts {
  /** The address as the Census Bureau matched it. */
  matchedAddress: string;
  state: string;
  stateName: string;
  county: string | null;
  /** Null when the state elects its one representative at large. */
  congressional: number | null;
  congressionalName: string | null;
  stateUpper: number | null;
  stateUpperName: string | null;
  stateLower: number | null;
  stateLowerName: string | null;
}

type Geo = Record<string, string | undefined>;

const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

/** The district number at the end of a GEOID, or null for at-large ("00", "98", "ZZZ"). */
function districtNumber(geo: Geo | undefined, stateFips: string): number | null {
  const tail = geo?.GEOID?.slice(stateFips.length) ?? '';
  const n = Number(tail);
  return /^\d+$/.test(tail) && n > 0 && n < 98 ? n : null;
}

/**
 * Looks up an address. Returns null when the Census Bureau finds no match. Layer names
 * change with each Congress and redistricting cycle ("120th Congressional Districts",
 * "2026 State Legislative Districts - Upper"), so they are matched by pattern.
 */
export async function geocodeAddress(
  address: string,
  doFetch: typeof fetch = fetch,
): Promise<AddressDistricts | null> {
  const url = new URL(GEOCODER);
  url.searchParams.set('address', address.slice(0, 200));
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('format', 'json');
  const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`The Census geocoder answered HTTP ${res.status}.`);
  const body = (await res.json()) as {
    result?: {
      addressMatches?: { matchedAddress: string; geographies: Record<string, Geo[]> }[];
    };
  };
  const match = body.result?.addressMatches?.[0];
  if (!match) return null;
  const layer = (re: RegExp) =>
    Object.entries(match.geographies).find(([name]) => re.test(name))?.[1]?.[0];
  const st = layer(/^States$/);
  const fips = st?.STATE ?? st?.GEOID ?? '';
  const usps = STATE_FIPS[fips];
  if (!st || !usps) return null;
  const cd = layer(/Congressional Districts$/);
  const upper = layer(/State Legislative Districts - Upper$/);
  const lower = layer(/State Legislative Districts - Lower$/);
  return {
    matchedAddress: match.matchedAddress,
    state: usps,
    stateName: st.NAME ?? usps,
    county: layer(/^Counties$/)?.NAME ?? null,
    congressional: districtNumber(cd, fips),
    congressionalName: cd?.NAME ?? null,
    stateUpper: districtNumber(upper, fips),
    stateUpperName: upper?.NAME ?? null,
    stateLower: districtNumber(lower, fips),
    stateLowerName: lower?.NAME ?? null,
  };
}
