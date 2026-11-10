# ADR-0358 - Lucy visible activity, genuine progress and music-specific tool details

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 0/8 In progress; 7/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy activity. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0303, ADR-0304, ADR-0305, ADR-0332; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyCards.tsx`; `web/src/views/LucyVisuals.tsx`; `web/src/styles/lucy.css`.

## Context and source/evidence boundary

Current Lucy activity cards already render actual search, analysis, seam, plan and render data with appropriate unknowns and fallbacks. Presentation refinements must not alter typed tool results. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Summarise work as a small truthful activity timeline with expandable music-specific visual evidence, de-emphasising completed operations. Do not display synthetic progress, music quality or animation.

## User outcome and interaction contract

Users know whether Lucy is searching, analysing, planning or waiting for approval and can inspect evidence without technical overload.

**Required negative cases:** Parallel steps, skipped tools, partial outputs, unknown families, failed tools, costly long work, no progress percentage and Still/reduced motion.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LX-0358-01 - Group meaningful milestones.** **Acceptance:** Show searching, checking, planning and completion from actual step events. **Required verification:** Event-stream timing and ordering test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/lucy/reducer.test.ts 'updates exactly the card each step event names, in any order' and 'never regresses a settled step' passed 2026-11-10 (cards built only from plan.started and step.* events). Reviewer: none.
2. **LX-0358-02 - Keep tool data truthful.** **Acceptance:** Use tool-returned song IDs, counts, tempo/key and seam outcomes; unknown stays unknown. **Required verification:** Adversarial partial-result fixtures. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-02 and -04 draw only what the step returned, and say unknown for the rest' passed 2026-11-10. Reviewer: none.
3. **LX-0358-03 - Refine compact card hierarchy.** **Acceptance:** Current running/failed card outranks completed logs; details expandable. **Required verification:** Long-run hierarchy study. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-03 a long plan leads with what failed and what is running' passed 2026-11-10. Needs a person: long-run hierarchy study.
4. **LX-0358-04 - Visualise musical steps.** **Acceptance:** Search matches, transition checks and order planning use compact semantic mini-UI. **Required verification:** Result-to-visual snapshot and provenance audit. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-02 and -04 draw only what the step returned' passed 2026-11-10 (search, transition and order mini-visuals from LucyVisuals.tsx). Reviewer: none.
5. **LX-0358-05 - Handle progress responsibly.** **Acceptance:** Known denominator uses numeric progress; indeterminate is labelled, no fake ETA. **Required verification:** Unknown-total and failed-progress tests. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-05 a known total is numeric, an unknown total says so, with no time estimate' passed 2026-11-10. Reviewer: none.
6. **LX-0358-06 - Make permission actions distinct.** **Acceptance:** Tool permission requests are clearly separate from informational step cards. **Required verification:** Allow/deny task and focus audit. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-06 a permission request is its own card with its own answer, outside the step log' passed 2026-11-10. Reviewer: none.
7. **LX-0358-07 - Respect motion preferences.** **Acceptance:** Activity animation only conveys actual work; Still retains full textual state. **Required verification:** prefers-reduced-motion and Still E2E. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Evidence: web/src/views/LucyLx.test.tsx 'LX-0358-07 the moving cue is only for real running work and goes when motion is Still' and web/src/styles/lx-design-language.test.tsx 'LX-0364-06' passed 2026-11-10. Reviewer: none.
8. **LX-0358-08 - Validate working-state trust.** **Acceptance:** Users correctly predict what happened and whether anything was saved/played. **Required verification:** Comprehension study with mixed runs. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Claude checklist agent; **Implementing PR/SHA:** feat/finish-checklists (working tree 2026-11-10); **Evidence/reviewer:** Needs a person: comprehension study with mixed runs (what happened, was anything saved or played).

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
