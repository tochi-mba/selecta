# ADR-0087: Verify WCAG, device reflow, audio latency and scale

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 3 Implemented (automated), 2 In progress, 6 need a person only (2026-11-10 reconciliation); 0/11 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 5 - cross-cutting quality
- **Extends:** ADR-0067, ADR-0068, ADR-0069, ADR-0073, ADR-0074. No inherited task is automatically complete.
- **Dependencies:** Applies throughout Phases 1–4, with integrated acceptance at the end.
- **Checklist:** S31-0087-01 through S31-0087-11 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/e2e/{pages,flows,listen,integration}.e2e.ts`, `web/src/styles/*.css`, `web/src/ui/*`, `tests/test_library_edges.py`, `docs/adr/selecta-3-accessibility.md`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Treat accessible task completion, reflow, accurate audio and measured performance as release conditions-not as incidental finishing decoration. Distinguish automated checks from human assistive-technology and real audio evidence.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0087-01 - Approve platform, width, zoom, orientation and keyboard matrix.** Acceptance: Matrix covers 320/375/390/430/768/1024/1280/1440/1920/3840 CSS px where meaningful. **Status (2026-11-10):** Not Verified. **Evidence:** Matrix drafted in `selecta-3-1-verification-matrix.md`. **Needs a person:** owner approves the platform/width/zoom/keyboard matrix.
2. **S31-0087-02 - Run full keyboard-only tasks across core journeys.** Acceptance: Skip link, menus, forms, tabs, waveform, timeline, Studio grid, requests and export have no traps. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` ("Tab reaches everything on every page at ${width}px", keyboard request, reorder, Studio, palette) passed. **Needs a person:** full keyboard-only journeys by a person.
3. **S31-0087-03 - Run manual supported screen-reader tasks with actual versions logged.** Acceptance: At minimum NVDA/Edge and available VoiceOver/TalkBack; unsupported/unavailable runs remain pending. **Status (2026-11-10):** Not Verified. **Needs a person:** NVDA/Edge and available VoiceOver/TalkBack sessions with versions logged.
4. **S31-0087-04 - Verify WCAG 2.2 AA reflow, focus, contrast and target size.** Acceptance: Record objective measurements/exceptions; 24px AA minimum is not falsely described as a universal 44px requirement. **Status (2026-11-10):** In progress, not Verified. **Evidence:** Target-size and reflow assertions in `web/e2e/mp-0281-mini-player.e2e.ts` and `finishing.e2e.ts`. **Needs a person:** record contrast, reflow, focus and 24px target measurements with exceptions.
5. **S31-0087-05 - Check reduced motion, colour-independent statuses and live announcements.** Acceptance: No flashing/chattering, no essential meaning relies only on colour or animated visuals. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `controls.test.tsx` ("never rely on colour alone"); `web/e2e/finishing.e2e.ts` announcement case; `web/src/ui/useReducedMotion.test.tsx` passed. **Needs a person:** owner review for Verified.
6. **S31-0087-06 - Verify mobile player/nav/keyboard/safe-area geometry under short viewports.** Acceptance: Focused controls and final list rows remain visible without overlap. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/finishing.e2e.ts` mini-player/bottom bar and on-screen keyboard cases passed. **Needs a person:** real phones with short viewports and safe areas.
7. **S31-0087-07 - Measure user interactions during background render on real hardware.** Acceptance: Record hardware, production build, input latency, long tasks and any audio timing disturbances. **Status (2026-11-10):** Not Verified. **Needs a person:** measure input latency and audio timing during background render on real hardware.
8. **S31-0087-08 - Profile 20k Library, 100-song Edit and full Studio grid.** Acceptance: Realistic search, reorder, scroll, repaint, memory and loading budgets defined from baseline. **Status (2026-11-10):** Not Verified. **Needs a person:** profile 20k Library, 100-song Edit and full Studio grid on real hardware.
9. **S31-0087-09 - Verify media continuity across page, theme, Stage, audition and tabs.** Acceptance: Real audible evidence shows correct owner, seek/transition timing and no surprise resume. **Status (2026-11-10):** Not Verified. **Needs a person:** audible continuity review across page, theme, Stage, audition and tabs.
10. **S31-0087-10 - Review PWA installed-mode startup and backend-unavailable recovery.** Acceptance: No claim of offline playback without running local server; direct routes and recovery remain truthful. **Status (2026-11-10):** In progress, not Verified. **Evidence:** `web/src/RuntimeApp.test.tsx` ("picks up by itself when a server that wasn't there starts") passed. **Needs a person:** installed-PWA startup with the backend stopped.
11. **S31-0087-11 - Define evidence-backed performance and accessibility budgets.** Acceptance: Use reference 200ms INP/0.1 CLS properly as context, not unsupported field compliance claim. **Status (2026-11-10):** Not Verified. **Needs a person:** owner approves evidence-backed budgets from measured baselines.

## Required adverse cases and evidence

- Axe passing alone does not establish WCAG conformance.
- Local lab metrics cannot be represented as 75th percentile field Core Web Vitals.
- Resizing while audio plays must not alter sound or mix scope.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

Testing several platforms and viewport combinations costs time; explicitly state officially supported combinations and document untested ones rather than claiming blanket support.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now also has limited frontend/test changes in other workstreams. This ADR remains Not started; implementation is tracked by task ID in the evidence ledger and no task is Verified.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Selected UI/Edge/test or visual-review infrastructure on draft PR #25; no human acceptance or task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 3 Implemented (automated), 2 In progress, 6 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/11 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
