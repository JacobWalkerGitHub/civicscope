# ADR 0003: Sources, citations and candidacy status

Status: accepted (Phase 1, part 3)

## Context

CivicScope's core promise is that every public fact can be traced to a source, and that
nothing appears publicly without one ("no citation, no publish").

## Decisions

- **One `source` row per document.** URLs are normalized (`normalizeSourceUrl`) and kept
  unique via a stored SHA-256 hash column, so citing a known URL reuses its source. A
  source's reliability tier is derived from its type (`sourceTier`), not typed by hand.
- **`citation` links a record (or one field of it) to a source.** Citations are soft
  deleted. The last citation of a published record can't be removed, and a source that
  is still cited can't be archived.
- **People have no party.** Party lives on each `candidacy`, because people change
  parties. In a partisan primary the candidacy always carries the primary's party.
- **Candidacy status is an append-only, sourced event log** (`candidacy_status_event`,
  protected by triggers). The current status is the event with the latest effective date.
  Mistakes are corrected by recording a new event with a note, never by editing history.
  Each event's source is also recorded as a citation of the candidacy's status.
- **Publishing follows the hierarchy.** Election → race → candidacy, and person →
  candidacy. A candidacy needs a published person and race, a status and a source. A
  parent can't be unpublished or archived while a public or live child depends on it.

## Consequences

- Claims (positions, biography, accomplishments) added later reuse `source` and
  `citation` by adding values to `CITATION_SUBJECTS`.
- Ingestion jobs (FEC, state lists) will cite their sources the same way, so imported
  data follows the same publishing rules as hand-entered data.

## Addendum: profile entries and review (Phase 1, part 4)

- Positions, biography items and accomplishments share one `claim` table with a `kind`
  column. CHECK constraints keep kind-specific fields (issue, statement type, biography
  category) on the right kind, and the database refuses a published entry that was never
  verified.
- Every entry is labeled with whose account it is (`content_kind`), so a candidate's own
  claims are never presented as established fact. Positions always quote the candidate's
  exact words.
- Workflow: draft → sent for review (needs a source) → a reviewer approves and publishes
  it, or sends it back with a note. Reviewers can't approve their own latest edits; the
  owner can, so a one-person team isn't stuck, and the audit log says so.
- An editor's change to a published entry takes it off the public site until a reviewer
  approves it. A reviewer's change stays published and is recorded as verified by them.

## Addendum: promises and record

- A campaign promise (a position with statement type `campaign_promise`) can have official
  records set next to it in `promise_record_link`: a congressional bill the person
  sponsored or cosponsored, a roll call they voted in, or a state vote they cast. The CMS
  only offers, and only accepts, records the person is on (through their Bioguide or Open
  States ID).
- Each link carries a short neutral note on what the record is. CivicScope does not rate
  promises as kept or broken, by design: the same standard for every party, and no verdict
  that a reviewer would have to defend as fact.
- Links are part of the promise's content. Adding or removing one follows the same rules
  as editing it (`reviewAfterEdit`): an editor's change takes a published promise down until
  a reviewer approves it. Links show publicly only while the promise and the record are both
  public.
