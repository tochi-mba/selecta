# ADR-0350 — Library 20,000-song paging, scroll restoration and input performance

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Library robustness. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0017, ADR-0062, ADR-0105, ADR-0291; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Library.tsx`; `web/src/views/Library.test.tsx`; `src/selecta/routes/library.py`.

## Context and source/evidence boundary

Library already uses 100-item cursor pages, 200-row shallow refresh, stable-ID deduplication and on-screen page refresh. New visuals must not destroy the existing scale characteristics. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Keep bounded cursor-backed rendering and preserve scroll/focus through searches, view changes and background analysis. Add virtualisation only with measurable benefit and accessibility parity.

## User outcome and interaction contract

Large collections remain responsive and exact song actions remain reliable after paging, sorting and cache refresh.

**Required negative cases:** 20k songs, deep cursor overlap, long row heights, more while polling, route return, hidden tab, slow device and memory pressure.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0350-01 — Baseline existing performance.** **Acceptance:** Record real 100/1k/20k collection interaction traces on named hardware. **Required verification:** Repeatable lab performance manifest. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0350-02 — Preserve cursor semantics.** **Acceptance:** Show more and deep return load correct unique IDs without duplicate/lost records. **Required verification:** Cursor overlap and page-depth E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0350-03 — Protect visible-page refresh.** **Acceptance:** Background analysis refreshes relevant loaded pages without eager all-rows polling. **Required verification:** API-call count and stale-refresh tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0350-04 — Preserve focus on reorder.** **Acceptance:** Updated readiness and sort order do not silently change targeted recording. **Required verification:** Focus/ID race fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0350-05 — Stabilise layout shift.** **Acceptance:** Rows with long names or new status do not jump scroll unpredictably. **Required verification:** CLS + scroll-anchor geometry trace. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0350-06 — Budget rendered work.** **Acceptance:** Avoid 20k eager cards/DOM and excessive rerender from unrelated playback ticks. **Required verification:** Profiler and 20k stress fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0350-07 — Test optional virtualisation.** **Acceptance:** If adopted, preserves keyboard, AT reading order, find, pagination and focus identity. **Required verification:** Virtualised versus nonvirtualised parity test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0350-08 — Set release thresholds.** **Acceptance:** Record acceptance budgets against measured baseline, not invented field data. **Required verification:** Named device p75 lab trace and reviewer signoff. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
