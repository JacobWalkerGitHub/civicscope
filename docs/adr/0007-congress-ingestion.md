# ADR 0007: Congress members, bills and House votes

Status: accepted (Phase 3, part 2)

## Context

Profiles need voting records and sponsored legislation for candidates who serve or
served in Congress. Congress.gov publishes members, bills, sponsors and House roll-call
votes, keyed by Bioguide ID. The FEC import (ADR 0006) knows people by FEC candidate ID.
Something has to connect the two without guessing.

## Decisions

- **The crosswalk comes from unitedstates/congress-legislators.** It lists each
  member's Bioguide ID next to their FEC candidate IDs and Wikidata ID
  (`pnpm ingest:legislators`, no key). Everyone current is included, plus former members
  whose last term ended on or after `--since` (default 2023-01-03, the start of the
  118th Congress), so votes by members who left mid-Congress still attach. Both files are
  snapshotted as-is in `ingest_snapshot`.
- **Matching is by ID only.** For each member, every CivicScope person holding one of
  their IDs is found:
  - one person: the IDs that person lacks are added (audited, attributed to the source);
  - nobody: a new draft person is created with all their IDs, cited to their Bioguide
    entry (government record) and to the dataset (reference) for the name;
  - several people, a same-name person without the IDs, or an archived person: nothing
    changes, and the run lists it for an editor. Merges are never guessed.
- **Congress records are stored by Bioguide ID, not person ID.** `congress_membership`,
  `bill_sponsorship` and `vote_position` keep the Bioguide ID and reach a person through
  `person_identifier`. Fixing or merging a person's IDs re-links their whole record with
  no rewrite, and a record whose member has no person yet waits and attaches as soon as
  someone adds the ID. Each run lists those unmatched members.
- **What `pnpm ingest:congress 119` fetches** (needs `CONGRESS_API_KEY`):
  - `/v3/member/congress/{n}?currentMember=false`: one membership row per member and
    chamber in that Congress (state as a USPS code, including D.C. and territories;
    district; party name). Cited to the member's Bioguide entry.
  - `/v3/bill/{n}`, then each changed bill's detail and `/cosponsors`: bills with their
    sponsor and cosponsors (original or not, date, withdrawal date). Cited to the bill's
    Congress.gov page (legislative record).
  - `/v3/house-vote/{n}/{session}`, then each changed vote's `/members`: one
    `roll_call_vote` and a `vote_position` per member, with the party and state the Clerk
    recorded. Cited to the Clerk's roll-call record. A "vote" is free text, because in an
    election for Speaker members vote for a name.
    Every response is validated (a mismatch fails the run) and snapshotted without the key.
- **Re-runs skip what hasn't changed.** Each row keeps Congress.gov's own `updateDate`;
  list pages are always fetched, details only when that stamp differs. A second run on the
  same data makes no writes and only fetches list pages. `--max-bills`, `--max-votes` and
  `--max-requests` cap a run; a capped run ends successfully and says so, and the next
  run continues (the first full 119th import is roughly 30,000 bill requests, about six
  hours at Congress.gov's 5,000 an hour).
- **Drafts, sourced, never overwriting editors.** Bills, votes and memberships start as
  drafts with a `source_id`, and updates write data columns only, never `publish_state`.
  The importer never edits a person's fields; it only adds IDs and creates new people.
  These records have no hand-editing in the CMS yet, so there are no locks to honour on
  them; when editing arrives, they join `LOCKABLE_FIELDS`.
- **One citation per record, not per vote.** A House vote has ~430 positions; they share
  their vote's source instead of each getting a `citation` row.
- **Its own disabled account**, "Automated import (Congress)", like the FEC one.

## Checking it

`pnpm check:congress-votes [--sample 60] [--candidates-only]` takes a random sample of
stored House votes attached to a person and checks each against the Clerk's record (the
stored response) and congress-legislators: the member's term on the vote date must be a
House seat in the state the Clerk recorded, and the person's name must share the Clerk's
surname. Swapping two people's Bioguide IDs makes both fail.

First check (2026-11-03), against live data: the live 2026 FEC House-incumbent list
(333 registrations, via the FEC import), the live congress-legislators files, and live
Congress.gov responses for House roll call 240 of 2025. The crosswalk linked all 280
FEC-imported incumbents and created 433 other members; all 430 positions in the vote
attached to a person, 278 of them to FEC-imported people, and 430 of 430 passed the check
(60 of 60 in a sample limited to FEC-imported people). A full run awaits a real key.

## Consequences

- Senate votes are not imported: Congress.gov has no Senate vote endpoint yet.
- Members are not shown on the public site yet; the admin person page shows what
  attached ("Record in Congress").
- Districts come from the member list's current district, which can differ from the
  district served in an older Congress after redistricting.
- Names on people created by the FEC import still use the FEC's capitalization guesses
  (e.g. "Lalota Nick"); an editor fixes them, and the crosswalk never overwrites them.
