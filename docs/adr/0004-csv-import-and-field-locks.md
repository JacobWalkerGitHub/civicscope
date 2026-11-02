# ADR 0004: CSV import, field locks and import conflicts

Status: accepted (Phase 1, part 6)

## Context

State candidate lists mostly arrive as spreadsheets or web pages, so editors need to
load a race's candidates from a file. Imports must not silently undo careful manual
work, and every imported fact still needs a source.

## Decisions

- **Upload, preview, then apply.** An upload stores the CSV text in `import_batch`. The
  preview re-checks it against the current database every time it is shown, and apply
  runs the same plan again inside one transaction: every row is written, or none are.
  A file with any row error can't be applied; the editor fixes the file and uploads it
  again. Only reviewers and the owner (`data:import`) can upload, apply or discard.
- **One file, one race, one source.** The uploader picks the race and gives the
  document the rows came from. Every new person and candidacy, and every changed
  candidacy, is cited to that source; status changes also get a `status` citation and
  a status event. New people and candidacies start as drafts.
- **Blank means "no information".** Imports never clear a value.
- **Matching never guesses.** A row matches a person by `person_id`, then FEC
  candidate ID, then a name already in this race. A name that matches someone outside
  the race is an error ("possible duplicate") until the file says which person
  (`person_id`) or `new`.
- **Field locks.** Changing an import-writable candidacy field by hand (name on the
  ballot, party, incumbent, website, FEC committee, status) locks it in `field_lock`.
  An import that disagrees with a locked field leaves it alone and opens a
  `review_item` conflict showing both values and the source. Accepting writes the
  source's value and removes the lock; keeping the current value leaves the lock.
  Reviewers can also unlock a field from the candidacy page.
- **Older statuses are skipped.** A file whose status date is older than the recorded
  status doesn't change it; the preview says so.
- **Person names are not updated by import.** The file's name is used to match and to
  create new people; changes to an existing person's name stay a manual edit.

## Consequences

The same plan/apply code and `review_item` table are meant for the scheduled ingestion
connectors later (FEC, state lists), so their rules can't drift from the CSV path.
