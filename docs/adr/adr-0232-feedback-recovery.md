# ADR-0232 - System-wide feedback, Undo, intentional interruptions and resilient recovery

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Cross-cutting.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0138/0182/0163; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/ui/controls.tsx; web/src/ui/toasts.tsx; web/src/views/Mix.tsx.

## Context and evidence boundary

Unify confirmation, optimistic gestures, processing, warnings and errors with stable user agency. Differentiate reversible edit, server-committed mutation and irreversible side effect. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Unify confirmation, optimistic gestures, processing, warnings and errors with stable user agency. Differentiate reversible edit, server-committed mutation and irreversible side effect. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No success toast before success, fake Undo, focus-stealing background status or duplicate destructive action. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0232-01 - Define feedback taxonomy.** **Acceptance:** Success, pending, blocked, failed and conflict distinct. **Required verification:** State inventory. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0232-02 - Specify Undo availability.** **Acceptance:** Only actually reversible actions offer Undo. **Required verification:** Source semantics audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0232-03 - Standardize progress copy.** **Acceptance:** Indeterminate and determinate jobs honest. **Required verification:** No-percentage fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0232-04 - Build error recovery patterns.** **Acceptance:** Retry and fallback actions tied to actual failure. **Required verification:** Injected network errors. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0232-05 - Clarify destructive confirmations.** **Acceptance:** Consequence and scope stated before commit. **Required verification:** Cancel safety tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0232-06 - Protect focus and announcements.** **Acceptance:** No unexpected modal or speech spam. **Required verification:** Keyboard/NVDA review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0232-07 - Handle stale async responses.** **Acceptance:** Old success cannot overwrite current failure or revision. **Required verification:** Race E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0232-08 - Measure recovery success.** **Acceptance:** People restore a failed edit or job correctly. **Required verification:** Fault-injection user study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0138/0182/0163; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
