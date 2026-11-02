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
