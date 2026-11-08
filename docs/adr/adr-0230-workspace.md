# ADR-0230 - Workspace for truthful analysis, source health, storage and diagnostics

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Workspace.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0156/0180/0128; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/Workshop.tsx; web/src/views/WorkshopPanels.tsx.

## Context and evidence boundary

Keep operations calm and transparent. Show distinct job stages and privacy boundaries for background analysis, sources, learning and storage without crowding listening screens. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Keep operations calm and transparent. Show distinct job stages and privacy boundaries for background analysis, sources, learning and storage without crowding listening screens. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No invented progress percentage, dangerous delete wording, hidden filesystem effects or noisy modal interruption. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0230-01 - Define Workspace information hierarchy.** **Acceptance:** Health, source, analysis and storage are findable. **Required verification:** Operator findability test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0230-02 - Design health summary.** **Acceptance:** Actionable issues above passive metrics. **Required verification:** Known-fault fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0230-03 - Clarify processing state.** **Acceptance:** Queued/running/blocked/failed counts use real backend values. **Required verification:** Job API test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0230-04 - Refine source management.** **Acceptance:** Paths, errors and safe removal consequences explicit. **Required verification:** Filesystem safety E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0230-05 - Design storage maintenance.** **Acceptance:** Preview, confirmation and accurate reclaim result. **Required verification:** Cancel/failure tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0230-06 - Make diagnostics usable.** **Acceptance:** Logs and identifiers locally safe with clear export actions. **Required verification:** Privacy review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0230-07 - Protect background calm.** **Acceptance:** Job updates never steal focus or auto-play. **Required verification:** Audio/attention E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0230-08 - Test operational recovery.** **Acceptance:** Users recover a stuck source without wrong action. **Required verification:** Scenario study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0156/0180/0128; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
