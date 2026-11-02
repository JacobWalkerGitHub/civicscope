# ADR 0006: FEC candidate ingestion

Status: accepted (Phase 3, part 1)

## Context

The MVP covers every federal candidate for 2028 with a minimal profile. The FEC's
OpenFEC API lists everyone who has registered as a federal candidate. Registration is
about campaign finance: it does not put anyone on a ballot, and many registrants never
appear on one.

## Decisions

- **What we fetch.** `GET /v1/candidates/` for one `election_year`, offices P, S and H,
  `candidate_status=C` (statutory candidates: raised or spent over $5,000), 100 per
  page. Inactive records are skipped. Every page is stored as-is in `ingest_snapshot`
  (without the API key), and every run is logged in `ingest_run`.
- **Fail loudly.** Each page is validated with Zod (`fecCandidatePageSchema`). A record
  that doesn't match fails the whole run, so a format change is noticed rather than
  half-imported. Rate limits and server errors are retried with backoff.
- **A status of its own.** FEC registrants get the candidacy status `registered`
  ("Registered with the FEC (not a ballot listing)"), dated with the FEC's first filing
  date. They are never marked `filed` or `qualified`; those come from state election
  authorities.
- **Where candidates go.** Each registration goes into that state's general-election
  race for the cycle: "U.S. Senate, Kentucky", "U.S. House, Kentucky District 6",
  "President of the United States" (under the country). Missing offices, congressional
  districts, elections and races are created as drafts. Districts are dated from the
  start of the election year, because the FEC names the district but not the map that
  drew it; an editor can record the plan later. Territories' delegates are listed for a
  person, because territories are not loaded yet.
- **The same pipeline as CSV imports.** Each race's registrations are turned into the
  rows of a candidate import and go through the same planner and apply step (ADR 4):
  - Rows are matched by FEC candidate ID first.
  - A name that matches an existing person without that ID is reported as a possible
    duplicate and left for a person. Merges are never guessed.
  - Locked fields are never changed; a difference opens a conflict in the review
    queue, once.
  - New people and candidacies are drafts, cited to the public FEC candidate list for
    that race (`https://www.fec.gov/data/candidates/...`, a government record).
- **Safe part applied automatically.** Rows that plan cleanly are applied as a
  dedicated, disabled admin account ("Automated import (FEC)"), so the audit log and
  revisions say who made each change. Nothing is published automatically.
- **Idempotent.** A race with nothing to change gets no import batch and no
  revisions, so a second run on the same data changes nothing except the "last checked"
  date of the FEC sources.
- **Parties** are matched by FEC code. A code with no party leaves the party empty and
  is listed on the run page, so an editor adds the party once and the next run fills it.

## Consequences

- Runs start from the command line (`pnpm ingest:fec 2028`) and need `FEC_API_KEY`.
  Scheduling comes with hosting (Phase 6).
- Special elections and candidates who switch races are not told apart yet: everyone
  goes into the regular general-election race.
- Withdrawals are not detected from the FEC (registrations rarely end). State
  withdrawal lists and editors handle them.
- The field names and filters were written from the OpenFEC documentation. The first live
  run must confirm them before the counts are trusted.
