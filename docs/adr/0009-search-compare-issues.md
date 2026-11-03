# ADR 0009: Search, side-by-side comparison and issue pages

Status: accepted (Phase 5)

## Context

Readers need to find a candidate or race without knowing where to look, to see the
candidates in one race next to each other, and to see where candidates stand on one issue.
None of these may invent information. A comparison that left a cell blank without saying
why, or filled it from a candidate's party, would mislead.

## Decisions

- **Comparisons are within one race only.** `/races/[id]/compare?c=…` takes candidacy IDs,
  drops any that are not public candidates in that race, and reports what it dropped. If
  none of the IDs fit, it shows the race's own candidates instead. Up to six columns, in
  alphabetical order like everywhere else.
- **Every cell is either cited or says "Nothing on file".** Rows are the issues where at
  least one compared candidate has a published position, then other positions, background
  and accomplishments. Each entry shows its sources, its statement type and whose account it
  is. An empty cell says "Nothing on file", and the page explains that this is not the same
  as holding no view. Nothing is inferred from party or from anyone else.
- **Search covers names, offices, states, districts, issues and entry text.** Names, races
  and issues are short, so they use plain matching: every word of the query must appear
  (`LIKE`, with wildcards stripped from the input). Entry titles and summaries use a MySQL
  `FULLTEXT` index in boolean mode, each word of three or more letters required and matched
  as a prefix. Results are limited to 25 per group and to upcoming elections unless the
  reader asks for past ones.
- **The full-text index is a hand-written migration** (`0016_search_fulltext.sql`) because
  Drizzle's MySQL schema can't declare one. `drizzle-kit generate` doesn't know about it,
  so it won't try to drop it.
- **Issue pages list published positions of candidates in upcoming races**, grouped by race,
  with a count of how many candidates in each race have a position on file. Candidates
  without one are counted, not listed as opposed. `/issues` lists every issue with how many
  candidates have a position on it.
- **Only public records.** Each query requires the entry, person, candidacy, race and
  election to be published and not archived, the same rules as the profile and race pages.
  Admin previews can see drafts through the same functions, marked "Not public".

## Consequences

- Search is good enough for the pilot's few hundred candidates. If it grows to thousands of
  races, names and races should move to the full-text index too, or to a search service.
- The comparison only shows what is published. In a race where nobody has entries yet it is
  mostly "Nothing on file", which is accurate.
