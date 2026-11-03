# ADR 0008: Election calendar, key dates and official links

Status: accepted (Phase 4, part 1)

## Context

Phase 4 covers the 2027 state pilot: Kentucky, Louisiana and Mississippi statewide races and
the Virginia General Assembly. Voters need to know when each election is, the deadlines before
it (filing, registration, early voting) and where the official information is. The schema had
`election_deadline` and `official_resource` tables from Phase 0, but nothing that read or
wrote them.

## Decisions

- **Every key date names its official source.** A date needs an https link to the document
  that sets it, usually the election authority's calendar or the statute. The admin form says
  never to copy a date from a previous cycle. The public page links the source next to each
  date.
- **Dates far from their election are refused** (more than two years before, or three months
  after). That is almost always a wrong year.
- **Dates and links have no draft state.** They appear once their election is published. So
  changing a published election's dates needs permission to publish, and so does changing a
  state's official links, which show on every published election there. Editors can still add
  dates to a draft election. The permission is worked out on the server from the stored
  record, never from what the browser sends.
- **Removing a date deletes the row and records it in the history.** A wrong date is better
  removed than archived. Links are archived instead, because they may come back.
  "I checked it works" stamps `last_checked_at` for links.
- **Public pages:**
  - `/elections` lists upcoming published elections by month with their dates, and offers
    `?year=` for each cycle.
  - `/elections/{id}` shows the election, how its primary works in plain words, its key
    dates, the races we cover, other elections in that state that year, and the state's
    official links.
  - Race pages link to their election and explain the primary system the same way. For
    example, Louisiana's governor race uses one ballot for all parties, and a majority wins
    outright.
- **The explanations describe the rules only.** They never say who a system favors.

## Addendum: the reviewed 2027 calendar (Phase 4, part 2)

- **The 2027 dates live in a reviewed file**, `packages/cms/src/calendar-data/2027.ts`. They
  were typed in by hand from the official documents and checked against them on 2026-11-03.
  `pnpm data:calendar --as <admin email>` loads the file through the normal CMS functions,
  so every record is validated and audited under that admin's name. Elections are created
  as drafts and go public only when a reviewer publishes them. Loading again changes
  nothing. A stored value that differs from the file is listed and left alone, because an
  editor may have corrected it.
- **Each election's official source is its `official_url`.** That is the document that
  sets or announces its date, and the public pages label it "Official source".
- **What is in the file:**
  - Louisiana's gubernatorial primary (October 9, 2027, one ballot for all parties) and
    general election (November 20, 2027), with qualifying, petition, registration,
    mail-ballot and early-voting dates. These come from the Secretary of State's "2027
    Elections" schedule, revised 10/2026, which says its dates are subject to change by the
    Legislature.
  - Virginia's primary (June 15, 2027, Code § 24.2-515) and general election (November 2,
    2027, Code § 24.2-101). Their key dates wait for the Department of Elections' 2027
    General Assembly bulletins, which are not published yet.
  - Official links for both states.
- **Not in the file:**
  - Kentucky and Mississippi. elect.ky.gov and sos.ms.gov refuse automated requests from
    the build environment, even with the domains allowed. Their dates go in once someone
    opens the official calendars and checks each entry.
  - Races. They come next, office by office.

## Still not in this part

- Candidates for the 2027 races. Filing opens in late 2026 or 2027 depending on the state,
  and every published candidate must trace to the official state list.
