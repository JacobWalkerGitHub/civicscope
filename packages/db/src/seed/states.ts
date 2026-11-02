/**
 * The 50 states and the District of Columbia.
 *
 * Source: U.S. Census Bureau, "2020 Census Codes for States, the District of
 * Columbia, Puerto Rico, and the Insular Areas"
 * https://www2.census.gov/geo/docs/reference/codes2020/national_state2020.txt
 * (linked from https://www.census.gov/library/reference/code-lists/ansi.html),
 * retrieved 2026-11-02. Columns: STATE (USPS), STATEFP (FIPS), STATENS (ANSI).
 *
 * Territories are intentionally excluded from the MVP seed; the jurisdiction
 * model supports them (type 'territory') when coverage expands.
 */
export const STATE_SOURCE_URL =
  'https://www2.census.gov/geo/docs/reference/codes2020/national_state2020.txt';

export interface StateSeed {
  usps: string;
  fips: string;
  ansi: string;
  name: string;
}

export const STATES: readonly StateSeed[] = [
  { usps: 'AL', fips: '01', ansi: '01779775', name: 'Alabama' },
  { usps: 'AK', fips: '02', ansi: '01785533', name: 'Alaska' },
  { usps: 'AZ', fips: '04', ansi: '01779777', name: 'Arizona' },
  { usps: 'AR', fips: '05', ansi: '00068085', name: 'Arkansas' },
  { usps: 'CA', fips: '06', ansi: '01779778', name: 'California' },
  { usps: 'CO', fips: '08', ansi: '01779779', name: 'Colorado' },
  { usps: 'CT', fips: '09', ansi: '01779780', name: 'Connecticut' },
  { usps: 'DE', fips: '10', ansi: '01779781', name: 'Delaware' },
  { usps: 'DC', fips: '11', ansi: '01702382', name: 'District of Columbia' },
  { usps: 'FL', fips: '12', ansi: '00294478', name: 'Florida' },
  { usps: 'GA', fips: '13', ansi: '01705317', name: 'Georgia' },
  { usps: 'HI', fips: '15', ansi: '01779782', name: 'Hawaii' },
  { usps: 'ID', fips: '16', ansi: '01779783', name: 'Idaho' },
  { usps: 'IL', fips: '17', ansi: '01779784', name: 'Illinois' },
  { usps: 'IN', fips: '18', ansi: '00448508', name: 'Indiana' },
  { usps: 'IA', fips: '19', ansi: '01779785', name: 'Iowa' },
  { usps: 'KS', fips: '20', ansi: '00481813', name: 'Kansas' },
  { usps: 'KY', fips: '21', ansi: '01779786', name: 'Kentucky' },
  { usps: 'LA', fips: '22', ansi: '01629543', name: 'Louisiana' },
  { usps: 'ME', fips: '23', ansi: '01779787', name: 'Maine' },
  { usps: 'MD', fips: '24', ansi: '01714934', name: 'Maryland' },
  { usps: 'MA', fips: '25', ansi: '00606926', name: 'Massachusetts' },
  { usps: 'MI', fips: '26', ansi: '01779789', name: 'Michigan' },
  { usps: 'MN', fips: '27', ansi: '00662849', name: 'Minnesota' },
  { usps: 'MS', fips: '28', ansi: '01779790', name: 'Mississippi' },
  { usps: 'MO', fips: '29', ansi: '01779791', name: 'Missouri' },
  { usps: 'MT', fips: '30', ansi: '00767982', name: 'Montana' },
  { usps: 'NE', fips: '31', ansi: '01779792', name: 'Nebraska' },
  { usps: 'NV', fips: '32', ansi: '01779793', name: 'Nevada' },
  { usps: 'NH', fips: '33', ansi: '01779794', name: 'New Hampshire' },
  { usps: 'NJ', fips: '34', ansi: '01779795', name: 'New Jersey' },
  { usps: 'NM', fips: '35', ansi: '00897535', name: 'New Mexico' },
  { usps: 'NY', fips: '36', ansi: '01779796', name: 'New York' },
  { usps: 'NC', fips: '37', ansi: '01027616', name: 'North Carolina' },
  { usps: 'ND', fips: '38', ansi: '01779797', name: 'North Dakota' },
  { usps: 'OH', fips: '39', ansi: '01085497', name: 'Ohio' },
  { usps: 'OK', fips: '40', ansi: '01102857', name: 'Oklahoma' },
  { usps: 'OR', fips: '41', ansi: '01155107', name: 'Oregon' },
  { usps: 'PA', fips: '42', ansi: '01779798', name: 'Pennsylvania' },
  { usps: 'RI', fips: '44', ansi: '01219835', name: 'Rhode Island' },
  { usps: 'SC', fips: '45', ansi: '01779799', name: 'South Carolina' },
  { usps: 'SD', fips: '46', ansi: '01785534', name: 'South Dakota' },
  { usps: 'TN', fips: '47', ansi: '01325873', name: 'Tennessee' },
  { usps: 'TX', fips: '48', ansi: '01779801', name: 'Texas' },
  { usps: 'UT', fips: '49', ansi: '01455989', name: 'Utah' },
  { usps: 'VT', fips: '50', ansi: '01779802', name: 'Vermont' },
  { usps: 'VA', fips: '51', ansi: '01779803', name: 'Virginia' },
  { usps: 'WA', fips: '53', ansi: '01779804', name: 'Washington' },
  { usps: 'WV', fips: '54', ansi: '01779805', name: 'West Virginia' },
  { usps: 'WI', fips: '55', ansi: '01779806', name: 'Wisconsin' },
  { usps: 'WY', fips: '56', ansi: '01779807', name: 'Wyoming' },
];

export const COUNTRY_OCD_ID = 'ocd-division/country:us';

/**
 * Open Civic Data division IDs: states are `state:<usps>`; DC is `district:dc`.
 * See https://github.com/opencivicdata/ocd-division-ids
 */
export function stateOcdId(usps: string): string {
  const code = usps.toLowerCase();
  return code === 'dc' ? `${COUNTRY_OCD_ID}/district:dc` : `${COUNTRY_OCD_ID}/state:${code}`;
}
