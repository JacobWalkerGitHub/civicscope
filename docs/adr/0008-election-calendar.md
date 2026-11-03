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

## Not in this part

- Loading the real 2027 dates and races. Each one needs the official calendar opened and
  checked, and the development environment can't reach the state election sites yet
  (elect.ky.gov, sos.la.gov, sos.ms.gov, elections.virginia.gov). Search results point to a
  published Kentucky 2027 calendar and a Louisiana 2027 calendar "subject to change by the
  Legislature". Neither has been opened, so nothing from them is recorded.
- Candidates for the 2027 races. Filing opens in late 2026 or 2027 depending on the state, and
  every published candidate must trace to the official state list.
