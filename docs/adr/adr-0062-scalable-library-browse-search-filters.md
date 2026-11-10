# ADR-0062: Scalable Library search, filters, rows and pagination

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 6 of 8 tasks implemented with automated evidence on 2026-11-10; 1 need a person; 1 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0017, ADR-0034, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Library supports URL-based search, Ready/Not yet/Priority/Set aside/Everything filters, ordering, pages of 100 and per-song actions. A readiness-only default risks making imported songs appear missing, while dense rows and long metadata compete with advanced actions.

## Decision proposed

Use a search-first Library with explicit filter scope, compact/comfortable density, contextual actions and responsive detail panel. Favor Everything as the proposed default, subject to usage testing; preserve Ready and all other filters and existing URL behavior.

## Experience and frontend architecture

- Search, filter, sort and pagination state are captured in URLs and restored across Back/Forward. Keep prior data visible during refresh but identify stale content and avoid announcing an empty library on fetch failure.

- Rows emphasize song title and artist; technical metrics occupy stable secondary columns. High-frequency actions remain directly reachable, less frequent actions enter accessible menus; no action is hover-only on touch.

- For 20,000 songs, profile scroll/fetch/render before virtualization; if introduced, retain roving focus, stable row identity, screen-reader list semantics and scroll restoration.

## Detailed implementation work

1. **S3-0062-01 - Implemented.** Create a Library header with search, filter controls, sort and real readiness summary. **Evidence:** web/src/views/Library.tsx header; web/src/views/Library.test.tsx 'shows how many there are, and fetches more without losing its place', 'keeps what you were looking for in the address' and 'distinguishes analysed songs from mix-ready songs without promising rendered transitions' (passed 2026-11-10).
2. **S3-0062-02 - Implemented.** Redesign row hierarchy and optional compact density without losing playback/analysis/set-aside actions. **Evidence:** web/src/views/Library.test.tsx 'preserves the same song actions, readiness reason and list while switching layouts' and 'shows bulk actions only for a real selection and returns focus to the compact entry when cleared' (passed 2026-11-10).
3. **S3-0062-03 - Needs a person.** Select default filter from measured task research; if changed, preserve existing saved query behavior. **Status:** Needs a person: choosing the default filter from measured task research with participants; the existing saved query behaviour is preserved (web/src/views/Library.test.tsx 'keeps what you were looking for in the address').
4. **S3-0062-04 - Implemented.** Make all search/filter/sort/deep-link combinations deterministic and keyboard accessible. **Evidence:** web/e2e/pages.e2e.ts 'the Library’s filters are part of its address'; web/src/views/Library.test.tsx 'keeps what you were looking for in the address' and 'restores the requested page depth when navigation changes only the URL'; web/e2e/finishing.e2e.ts 'a slow search can’t replace a newer one, and typing keeps its place' (passed 2026-11-10).
5. **S3-0062-05 - Implemented.** Implement stale-request cancellation and a truthful refreshing/failure experience. **Evidence:** web/src/views/Library.test.tsx 'only the newest search counts, however the answers arrive' and 'not being able to load isn’t the same as having no songs'; web/e2e/finishing.e2e.ts 'a slow search can’t replace a newer one, and typing keeps its place' (passed 2026-11-10).
6. **S3-0062-06 - Implemented.** Preserve 100-item incremental loading or a tested equivalent with stable scroll and selection. **Evidence:** web/src/views/Library.test.tsx 'shows how many there are, and fetches more without losing its place', 'reloads an edited song on a middle page, not just the first or last page' and 'a song that turns up on two pages only shows once'; tests/test_library_edges.py test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick (passed 2026-11-10).
7. **S3-0062-07 - In progress.** Profile 20k tracks under background analysis and implement targeted optimization only if needed. **Status:** In progress: tests/test_library_edges.py test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick proves 20k paging, but no profile under background analysis has been recorded.
8. **S3-0062-08 - Implemented.** Test long/unicode/RTL/duplicate/missing metadata and touch row actions. **Evidence:** tests/test_library_edges.py test_any_name_comes_back_exactly_as_it_is_and_can_be_searched_for, test_songs_with_the_same_name_are_kept_apart, test_songs_missing_things_still_turn_up_in_every_order and test_a_song_whose_file_has_moved_says_so; web/src/views/Library.test.tsx 'makes duplicate recording IDs visible in both rows and song details'; web/e2e/finishing.e2e.ts 'long, right-to-left and duplicate names stay readable and whole at the smallest size' (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Queries with special characters and out-of-order responses; URL reload and Back/Forward.
- 20k rows, repeated Show more and server changes mid-pagination without duplicates/holes.
- Action availability under partial readiness; no mismatch between row label and canonical ability.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Move to a complex spreadsheet interface: efficient for a subset of experts but hurts casual users. Keep the existing rows unchanged: least risk but misses discoverability and density issues. The proposed design balances both.

## Acceptance and evidence

Users can find every imported song, understand applied filters, and operate a large library without losing context or invoking unsupported actions.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (6/8) | Task-by-task evidence on each item; 1 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
