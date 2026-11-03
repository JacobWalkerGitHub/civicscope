import type { DistrictType, LegislativeChamber } from '@civicscope/core';

/*
 * The four state legislatures with regular elections in 2027, checked by hand against
 * official sources on 2026-11-03. Each chamber names the document that fixes its size
 * and term. District maps are not recorded here: each district is dated from the start of
 * 2027 until an editor records the plan that drew it, the same rule the FEC import uses.
 *
 * Every chamber in all four states is on the 2027 ballot:
 * - Virginia: the House every two years and the Senate every four (elected 2023).
 * - New Jersey: the Assembly every two years; the Senate's 2-4-4 cycle puts a four-year
 *   term on the 2027 ballot (elected 2023).
 * - Louisiana and Mississippi: both chambers every four years (elected 2023).
 *
 * Mississippi's constitution sets ceilings (52 and 122) and leaves the actual numbers to
 * statute (Miss. Code §§ 5-1-1 and 5-1-3), which could not be opened on an official site
 * from the build environment. Both chambers sit at the ceiling; an editor should confirm
 * that against the Legislature's roster before the Mississippi races are published.
 */

export interface LegislativeChamberData {
  state: string;
  chamber: Exclude<LegislativeChamber, 'unicameral'>;
  /** The office as voters see it on the ballot. */
  title: string;
  districts: number;
  /** Members elected from each district. */
  seatsPerDistrict: number;
  termYears: number;
  /** Official document that fixes the chamber's size. */
  sourceUrl: string;
}

export interface LegislatureData {
  checkedOn: string;
  /** Districts take effect from this date until an editor records the plan. */
  districtsValidFrom: string;
  chambers: LegislativeChamberData[];
}

export const LEGISLATURES_2027: LegislatureData = {
  checkedOn: '2026-11-03',
  districtsValidFrom: '2027-01-01',
  chambers: [
    {
      state: 'VA',
      chamber: 'upper',
      title: 'Senate of Virginia',
      districts: 40,
      seatsPerDistrict: 1,
      termYears: 4,
      sourceUrl: 'https://law.lis.virginia.gov/vacode/title24.2/chapter3/section24.2-304.05/',
    },
    {
      state: 'VA',
      chamber: 'lower',
      title: 'Virginia House of Delegates',
      districts: 100,
      seatsPerDistrict: 1,
      termYears: 2,
      sourceUrl: 'https://law.lis.virginia.gov/vacode/title24.2/chapter3/section24.2-304.05/',
    },
    {
      state: 'NJ',
      chamber: 'upper',
      title: 'New Jersey Senate',
      districts: 40,
      seatsPerDistrict: 1,
      termYears: 4,
      // Constitution Art. IV, § II: forty senators; eighty members of the General
      // Assembly, two from each legislative district.
      sourceUrl: 'https://www.njleg.state.nj.us/constitution',
    },
    {
      state: 'NJ',
      chamber: 'lower',
      title: 'New Jersey General Assembly',
      districts: 40,
      seatsPerDistrict: 2,
      termYears: 2,
      sourceUrl: 'https://www.njleg.state.nj.us/constitution',
    },
    {
      state: 'LA',
      chamber: 'upper',
      title: 'Louisiana State Senate',
      districts: 39,
      seatsPerDistrict: 1,
      termYears: 4,
      // Const. Art. III, § 3 caps the chambers at 39 and 105; the House's own guide
      // says both are at the maximum, with single-member districts and four-year terms.
      sourceUrl:
        'https://house.louisiana.gov/SLG/PDF/Chapter%201%20Part%20A%20-%20The%20Legislative%20Branch.pdf',
    },
    {
      state: 'LA',
      chamber: 'lower',
      title: 'Louisiana House of Representatives',
      districts: 105,
      seatsPerDistrict: 1,
      termYears: 4,
      sourceUrl:
        'https://house.louisiana.gov/SLG/PDF/Chapter%201%20Part%20A%20-%20The%20Legislative%20Branch.pdf',
    },
    {
      state: 'MS',
      chamber: 'upper',
      title: 'Mississippi State Senate',
      districts: 52,
      seatsPerDistrict: 1,
      termYears: 4,
      // Constitution § 254 (Secretary of State's edition): not more than 52 and 122.
      sourceUrl:
        'https://www.sos.ms.gov/sites/default/files/publications/Mississippi_Constitution.pdf',
    },
    {
      state: 'MS',
      chamber: 'lower',
      title: 'Mississippi House of Representatives',
      districts: 122,
      seatsPerDistrict: 1,
      termYears: 4,
      sourceUrl:
        'https://www.sos.ms.gov/sites/default/files/publications/Mississippi_Constitution.pdf',
    },
  ],
};

export function districtType(chamber: LegislativeChamberData['chamber']): DistrictType {
  return chamber === 'upper' ? 'state_upper' : 'state_lower';
}

/** Open Civic Data ID of a state legislative district, e.g. ocd-division/country:us/state:va/sldl:12. */
export function districtOcdId(
  state: string,
  chamber: LegislativeChamberData['chamber'],
  n: number,
) {
  return `ocd-division/country:us/state:${state.toLowerCase()}/${chamber === 'upper' ? 'sldu' : 'sldl'}:${n}`;
}
