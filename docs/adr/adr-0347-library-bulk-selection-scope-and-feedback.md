# ADR-0347 - Library explicit selection mode, exact scope and batch feedback

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library interaction. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0258, ADR-0267, ADR-0291, ADR-0314; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/views/Library.test.tsx`; `src/selecta/routes/library.py`.

## Context and source/evidence boundary

Source already supports stable-ID selection, a limit of 200 loaded recordings, guarded batch mutation, confirmation and focus return. Redesign is a presentation proposal, not a new bulk endpoint. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Make selection an intentional context with one compact entry point, exact loaded-result count, visible selected identity, grouped actions and safe exit. Preserve the existing atomic guard and 200-item limit.

## User outcome and interaction contract

Users can select, inspect and change multiple exact recordings without thinking they selected the full filtered 20k-song library.

**Required negative cases:** 0/1/200 selected, 201st row, query/sort/filter changes, stale batch, single error, duplicate title and browser Back.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0347-01 - Design zero-selection affordance.** **Acceptance:** Browsing shows compact discoverable selection without an always-on bulk action forest. **Required verification:** No-selection visual and keyboard discovery. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0347-02 - Declare exact selection scope.** **Acceptance:** Count states selected of loaded and limit 200, never all search results. **Required verification:** 20k paged and AT wording tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0347-03 - Create contextual action rail.** **Acceptance:** Real nonzero selection reveals only valid batch actions with clear hierarchy. **Required verification:** 0/1/200 selection snapshot matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0347-04 - Show selected recordings safely.** **Acceptance:** Confirmation previews exact IDs/titles, duplicates and changed flags before mutation. **Required verification:** Duplicate-title and optimistic-lock E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0347-05 - Keep selection invalidation.** **Acceptance:** Changes of query/sort/filter/depth invalidate old selection, not silently transfer it. **Required verification:** Stale query/filter race tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0347-06 - Restore focus on exit.** **Acceptance:** Clear/cancel/confirmed batch returns focus to a stable reachable browse control. **Required verification:** Keyboard focus-return and screen-reader study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0347-07 - Preserve server atomicity.** **Acceptance:** No partial mutation or incorrect claim when concurrent edits invalidate expected state. **Required verification:** Concurrency and failure transaction fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0347-08 - Test selection confidence.** **Acceptance:** People identify selected scope and can undo/cancel before changing anything. **Required verification:** Novice batch-action comprehension study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
