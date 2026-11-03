import type {
  ElectionDeadlineKind,
  ElectionType,
  OfficialResourceKind,
  PrimarySystem,
} from '@civicscope/core';

/*
 * The 2027 pilot calendar, typed in by hand from official documents and checked line by
 * line against them. Each election names the document that sets its date (its
 * `officialUrl`), and each key date names its own source. Nothing here was copied from
 * a previous cycle, worked out from a pattern, or taken from a secondary source.
 *
 * Opened and checked on 2026-11-03:
 * - Louisiana: "2027 Elections" schedule, Louisiana Secretary of State, revised 10/2026
 *   ("dates are subject to change by the Legislature").
 * - Virginia: Code of Virginia § 24.2-515 (primaries on the third Tuesday in June) and
 *   § 24.2-101 ("general election" is the Tuesday after the first Monday in November).
 *   The Department of Elections had not yet published 2027 General Assembly bulletins.
 *
 * Not here yet, because the official source could not be opened from the build
 * environment (the sites refuse automated requests): Kentucky (elect.ky.gov) and
 * Mississippi (sos.ms.gov).
 */

export interface CalendarDeadline {
  kind: ElectionDeadlineKind;
  date: string;
  label: string;
  sourceUrl: string;
}

export interface CalendarElection {
  state: string;
  type: ElectionType;
  primarySystem: PrimarySystem;
  date: string;
  name: string;
  /** The official document that sets or announces the date. */
  officialUrl: string;
  deadlines: CalendarDeadline[];
}

export interface CalendarResource {
  state: string;
  kind: OfficialResourceKind;
  label: string;
  url: string;
}

export interface CalendarData {
  /** When the sources were last opened and checked against these entries. */
  checkedOn: string;
  elections: CalendarElection[];
  resources: CalendarResource[];
}

const LA_2027 = 'https://www.sos.la.gov/media/byfpyc5f/elections-calendar-2027.pdf';
const VA_PRIMARY = 'https://law.lis.virginia.gov/vacode/title24.2/chapter5/section24.2-515/';
const VA_GENERAL = 'https://law.lis.virginia.gov/vacode/title24.2/chapter1/section24.2-101/';

const la = (kind: ElectionDeadlineKind, date: string, label: string): CalendarDeadline => ({
  kind,
  date,
  label,
  sourceUrl: LA_2027,
});

export const CALENDAR_2027: CalendarData = {
  checkedOn: '2026-11-03',
  elections: [
    {
      state: 'LA',
      type: 'primary',
      // One ballot for every candidate whatever their party; a majority wins outright.
      // The 2027 schedule lists this as the "Gubernatorial Primary", separate from the
      // closed BESE party primaries in April and May.
      primarySystem: 'jungle',
      date: '2027-10-09',
      name: 'Louisiana Gubernatorial Primary 2027',
      officialUrl: LA_2027,
      deadlines: [
        la('petition', '2027-04-05', 'First day to obtain signatures for nominating petitions'),
        la(
          'petition',
          '2027-07-06',
          'Deadline to submit nominating petitions to the registrar of voters',
        ),
        la('filing_open', '2027-08-03', 'Candidate qualifying begins (qualifying runs August 3–5)'),
        la('filing_close', '2027-08-05', 'Candidate qualifying ends'),
        la('voter_registration', '2027-09-08', 'Deadline to register in person or by mail'),
        la('voter_registration', '2027-09-18', 'Deadline to register online through Geaux Vote'),
        la('early_voting_start', '2027-09-25', 'Early voting begins'),
        la('early_voting_end', '2027-10-02', 'Early voting ends'),
        la(
          'mail_ballot_request',
          '2027-10-05',
          'Deadline to request a mail ballot from the registrar (other than military and overseas voters)',
        ),
        la(
          'other',
          '2027-10-08',
          'Deadline for the registrar to receive a voted mail ballot (other than military and overseas voters)',
        ),
      ],
    },
    {
      state: 'LA',
      type: 'general',
      primarySystem: 'not_applicable',
      date: '2027-11-20',
      name: 'Louisiana Gubernatorial General Election 2027',
      officialUrl: LA_2027,
      deadlines: [
        la('voter_registration', '2027-10-20', 'Deadline to register in person or by mail'),
        la('voter_registration', '2027-10-30', 'Deadline to register online through Geaux Vote'),
        la(
          'early_voting_start',
          '2027-11-05',
          'Early voting begins (a day early because of the Veterans Day holiday)',
        ),
        la('early_voting_end', '2027-11-13', 'Early voting ends'),
        la(
          'mail_ballot_request',
          '2027-11-16',
          'Deadline to request a mail ballot from the registrar (other than military and overseas voters)',
        ),
        la(
          'other',
          '2027-11-19',
          'Deadline for the registrar to receive a voted mail ballot (other than military and overseas voters)',
        ),
      ],
    },
    {
      state: 'VA',
      type: 'primary',
      // Virginia has no party registration: any voter may choose one party's primary.
      // A party may nominate by convention or another method instead of a primary.
      primarySystem: 'open_partisan',
      date: '2027-06-15',
      name: 'Virginia Primary Elections 2027',
      officialUrl: VA_PRIMARY,
      deadlines: [],
    },
    {
      state: 'VA',
      type: 'general',
      primarySystem: 'not_applicable',
      date: '2027-11-02',
      name: 'Virginia General Election 2027',
      officialUrl: VA_GENERAL,
      deadlines: [],
    },
  ],
  resources: [
    {
      state: 'LA',
      kind: 'election_authority',
      label: 'Louisiana Secretary of State: Elections and voting',
      url: 'https://www.sos.la.gov/elections-voting',
    },
    {
      state: 'LA',
      kind: 'other',
      label: 'Louisiana election dates and calendars',
      url: 'https://www.sos.la.gov/elections-voting/election-dates',
    },
    {
      state: 'LA',
      kind: 'voter_registration',
      label: 'Register to vote in Louisiana',
      url: 'https://www.sos.la.gov/elections-voting/register-to-vote',
    },
    {
      state: 'LA',
      kind: 'polling_place',
      label: 'Louisiana polling locations',
      url: 'https://www.sos.la.gov/elections-voting/polling-locations',
    },
    {
      state: 'VA',
      kind: 'election_authority',
      label: 'Virginia Department of Elections',
      url: 'https://www.elections.virginia.gov/',
    },
    {
      state: 'VA',
      kind: 'other',
      label: 'Virginia upcoming elections and deadlines',
      url: 'https://www.elections.virginia.gov/casting-a-ballot/calendars-schedules/upcoming-elections.html',
    },
    {
      state: 'VA',
      kind: 'candidate_list',
      label: 'Virginia candidate lists',
      url: 'https://www.elections.virginia.gov/casting-a-ballot/candidate-list/',
    },
  ],
};
