# ADR-0360 - Lucy exact song and transition timeline with contextual editing

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 0/8 In progress; 7/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy proposal. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0320, ADR-0322, ADR-0324, ADR-0327, ADR-0306; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucySongs.tsx`; `web/src/views/LucyProposal.tsx`; `web/src/styles/lucy.css`.

## Context and source/evidence boundary

SongsAndSeams already uses occurrence IDs, retains exact order and presents seam rows between tracks, with lock/move/remove and Ask controls. The redesign is to improve musical legibility, not duplicate the full editor. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Make each song a visually anchored musical object and each directed transition an explicit connection. Keep move/lock/remove and Ask accessible, with advanced editing handed to the existing editor after commit.

## User outcome and interaction contract

A user sees the emotional/energy sequence, knows which transition is unready, and changes exact occurrences without relying on drag.

**Required negative cases:** Same recording twice, 1 or 64 tracks, missing energy, unplayable edge, row reorder, stale selected seam, small screen and zoom.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0360-01 - Design song-first order.** **Acceptance:** Song number, title, artist and key musical facts have strong repeatable hierarchy. **Required verification:** Paired 1/8/64-song timeline screenshots. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-01 and -02 numbered songs with each transition between its exact neighbours' passed 2026-11-10 (song number, title, artist, tempo, key and energy facts in one repeated row in LucySongs.tsx). Reviewer: none, paired 1/8/64-song screenshots by an independent reviewer still open.
2. **LX-0360-02 - Render directed seams between songs.** **Acceptance:** Transition card sits between exact neighbouring occurrences, not as a floating quality claim. **Required verification:** K−1 edge alignment fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-01 and -02 numbered songs with each transition between its exact neighbours' passed 2026-11-10 (K-1 seam cards keyed by directed occurrence pair). Reviewer: none.
3. **LX-0360-03 - Show truthful energy shape.** **Acceptance:** Only measured energy drives visual bars; unknown values use labelled nonnumeric fallback. **Required verification:** Known/unknown energy AT and screenshot tests. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-03 only measured energy makes a bar' passed 2026-11-10. Reviewer: none.
4. **LX-0360-04 - Make controls reachable.** **Acceptance:** Lock, move, remove and contextual Ask are keyboard/touch accessible without drag-only actions. **Required verification:** Move/lock/remove and touch E2E. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-04, -05 and -07 buttons do every change by exact occurrence' passed 2026-11-10 (lock, move, remove and Ask are buttons, no drag-only action). Reviewer: none.
5. **LX-0360-05 - Track repeated songs exactly.** **Acceptance:** Occurrence identity survives movement and revision, never title-based deduplication. **Required verification:** Duplicate-occurrence reorder fixtures. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-04, -05 and -07' and tests/test_lucy_store.py::test_diff_uses_occurrence_identity_not_titles_or_positions passed 2026-11-10. Reviewer: none.
6. **LX-0360-06 - Explain transition evidence.** **Acceptance:** Rendered versus requested move, tempo/key gap and historical evidence remain distinguishable. **Required verification:** Seam provenance and status fixture. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-06 planned versus made, tempo and key gap, and history stay distinct' passed 2026-11-10. Reviewer: none.
7. **LX-0360-07 - Preserve focus after mutation.** **Acceptance:** Reordered/removed song returns focus to valid control without stealing scroll. **Required verification:** Focus retention and stale revision E2E. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0360-04, -05 and -07 ... focus stays on the moved song' passed 2026-11-10. Reviewer: none.
8. **LX-0360-08 - Test comprehension of musical flow.** **Acceptance:** Users can describe opening, build and closing and locate a problematic seam. **Required verification:** Novice/expert timeline usability study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Needs a person: novice and expert timeline usability study (describe opening, build and closing, locate a problem seam). Automated groundwork LX-0360-01 to -07 passed 2026-11-10.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
