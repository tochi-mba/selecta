# ADR-0343 - Library filters, sorting and optional musical-query depth

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library retrieval. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0291, ADR-0251, ADR-0226, ADR-0153; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `src/selecta/routes/library.py`; `web/src/api.ts`.

## Context and source/evidence boundary

Current filters include Everything, Ready, Not analysed, Needs attention, Priority and Set aside, with sorting by title, artist, tempo and recency. BPM range, key and duration are redesign candidates, not currently proven server filters. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Use a short high-frequency filter row and an accessible advanced filter disclosure; ensure every visible filter is backed by a real supported query and clearly indicates active state and result scope.

## User outcome and interaction contract

A listener narrows to ready songs quickly while an expert refines an exact musical selection without confusing unanalysed with filtered-out.

**Required negative cases:** Unknown BPM/key, zero results, incompatible filters, stale counts, 20k data, saved URL, resorting during analysis and touch overflow.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0343-01 - Prioritise frequent filters.** **Acceptance:** Show All, Ready, Processing and Needs attention with plain labels; retain priority/set-aside access. **Required verification:** Uncoached filter discovery and copy study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **LX-0343-02 - Make active state obvious.** **Acceptance:** Selected chips and clear-all state are visible with text/ARIA, not colour alone. **Required verification:** Keyboard, theme and pressed-state tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **LX-0343-03 - Preserve supported sorting.** **Acceptance:** Existing title/artist/tempo/recent ordering remains consistent with URL and server authority. **Required verification:** Full sort comparison and Back/Forward E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **LX-0343-04 - Specify advanced panel.** **Acceptance:** Optional BPM, key, duration and artist filters only appear after source/API capability is approved. **Required verification:** Capability matrix and empty-data contract review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **LX-0343-05 - Explain unknown musical facts.** **Acceptance:** Unknown tempo/key records are not silently treated as matching a music-specific query. **Required verification:** Missing-feature fixture and result explanation. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **LX-0343-06 - Keep scope on layout switches.** **Acceptance:** List/card/density toggles never change filter meaning or silently broaden selection. **Required verification:** Cross-mode scope parity tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **LX-0343-07 - Design zero-result recovery.** **Acceptance:** Explain active constraints and offer reversible clear/reset without dropping song identity. **Required verification:** Empty + combinations usability test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **LX-0343-08 - Validate musical refinement.** **Acceptance:** Expert tasks get faster without degrading ordinary search or creating hidden required steps. **Required verification:** Timed novice/expert search study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
