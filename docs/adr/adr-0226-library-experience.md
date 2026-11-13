# ADR-0226 - Library as both personal record collection and fast professional index

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 0/8 In progress, 2/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Library.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0153/0177/0123; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/Library.tsx; web/src/state/readiness.ts.

## Context and evidence boundary

Offer expressive collection browsing and information-dense list modes for 20,000-song local libraries, preserving filtering, cursor paging, exact metadata and responsiveness. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Offer expressive collection browsing and information-dense list modes for 20,000-song local libraries, preserving filtering, cursor paging, exact metadata and responsiveness. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No full-library eager DOM render, false playability or lost query/focus after result changes. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0226-01 - Design collection view.** **Acceptance:** Artwork and identity support discovery without fake traits. **Required verification:** Real/empty media tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork'; `web/src/views/Library.test.tsx` 'preserves the same song actions, readiness reason and list while switching layouts', 'offers an actual next step for a library without source music' (2026-11-10).
2. **SF-0226-02 - Refine professional table.** **Acceptance:** Sorting, columns and dense scanning remain clear. **Required verification:** Expert task review. **Implementation:** Needs a person: expert task review of the dense table. Automated part: `web/src/views/Library.test.tsx` 'keeps what you were looking for in the address' (sort survives in the address) passed 2026-11-12; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0226-03 - Protect large-library paging.** **Acceptance:** Twenty thousand items navigable without long stalls. **Required verification:** Scale performance fixture. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `tests/test_library_edges.py::test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick`; `tests/test_api_contracts.py::test_carrying_on_gets_the_rest_with_nothing_repeated_or_skipped` (2026-11-10).
4. **SF-0226-04 - Improve search and filters.** **Acceptance:** Active filter state and cursor boundaries accurate. **Required verification:** Query E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Library.test.tsx` 'keeps what you were looking for in the address', 'only the newest search counts'; `web/e2e/pages.e2e.ts` 'the Library's filters are part of its address'; `web/e2e/finishing.e2e.ts` 'a slow search can't replace a newer one' (2026-11-10).
5. **SF-0226-05 - Preserve focus and scroll.** **Acceptance:** Pagination never unpredictably moves keyboard focus. **Required verification:** Keyboard fixture. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** built: last page hands focus from Show more to the first new song (`web/src/views/Library.tsx`); `web/src/views/Library.test.tsx` 'keeps focus on Show more while pages remain, then hands it to the first new song on the last page' (2026-11-10).
6. **SF-0226-06 - Expose readiness honestly.** **Acceptance:** Ready, analyzing, blocked and missing distinct. **Required verification:** Readiness tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Library.test.tsx` 'distinguishes analysed songs from mix-ready songs', 'gives the reason in the song's details'; `web/src/state/readiness.test.ts`; `tests/test_library_edges.py::test_a_song_analysis_gave_up_on_says_so_rather_than_looking_ready`, `::test_a_song_whose_file_has_moved_says_so` (2026-11-10).
7. **SF-0226-07 - Handle empty and errors.** **Acceptance:** No results versus offline versus missing source differentiated. **Required verification:** Failure fixture. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Library.test.tsx` 'not being able to load isn't the same as having no songs', 'offers an actual next step for a library without source music'; `tests/test_library_edges.py::test_a_song_whose_file_has_moved_says_so` (2026-11-10).
8. **SF-0226-08 - Compare modes with users.** **Acceptance:** Both casual browsing and DJ retrieval efficient. **Required verification:** Timed task study. **Implementation:** Needs a person: timed casual/DJ task study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0153/0177/0123; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 6/8 Implemented (2026-11-10); 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
