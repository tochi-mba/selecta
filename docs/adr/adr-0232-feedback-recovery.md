# ADR-0232 - System-wide feedback, Undo, intentional interruptions and resilient recovery

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 3/8 In progress, 1/8 Not started; 2026-11-10).
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

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0232-01 - Define feedback taxonomy.** **Acceptance:** Success, pending, blocked, failed and conflict distinct. **Required verification:** State inventory. **Implementation:** Implemented; success, pending, blocked, failed, conflict and needs-you each have their own words and mark, and a 409 is read as a conflict, never a failure; inventory in docs/engineering/flow-cross-cutting.md; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Feedback taxonomy; `web/src/state/feedbackTaxonomy.test.tsx` (2 passed); `web/src/ui/controls.test.tsx` 'problems are announced as problems', 'never rely on colour alone'; `tests/test_flow_cross_cutting.py` 'test_every_section_is_there'; all run 2026-11-10.
2. **SF-0232-02 - Specify Undo availability.** **Acceptance:** Only actually reversible actions offer Undo. **Required verification:** Source semantics audit. **Implementation:** Implemented; Undo is offered only where the server keeps a restore point or the client holds the exact inverse; export, render, cancel and other side effects offer none and say so; audit table in docs/engineering/flow-cross-cutting.md; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Undo availability; `web/src/ui/controls.test.tsx` 'Undo runs what that message was about', 'says so if undoing fails', 'keeps older Undo blocked while the newer one runs and after it fails'; `web/src/ui/CommandPalette.test.tsx` 'shows exact Undo scope but refuses an unavailable mutation'; `web/src/views/Drafts.test.tsx`, `web/src/views/Mix.test.tsx` 'deleting closes it, goes back to the list, and can be undone', `web/src/views/Requests.test.tsx` 'can be undone from the message that says it joined'; all passed 2026-11-10.
3. **SF-0232-03 - Standardize progress copy.** **Acceptance:** Indeterminate and determinate jobs honest. **Required verification:** No-percentage fixtures. **Implementation:** In progress; `web/src/views/flowProgressCopy.test.tsx` (counts in real units, no made-up percentage; says it cannot tell when the server gives no status) exists from an earlier round but was not rerun this session because of laptop load; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0232-04 - Build error recovery patterns.** **Acceptance:** Retry and fallback actions tied to actual failure. **Required verification:** Injected network errors. **Implementation:** Implemented; a failed or unreachable server is shown as a failure (never an empty library), and Retry sits beside the failure, keeping the input, the selected transition and the next step; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/mp-0297-loading-and-recovery.e2e.ts` 'MP-0297-02 a failed or unreachable server never looks like an empty library', 'MP-0297-05 retry sits beside the failure and keeps the input, the selected transition and the next step' (injected server failures; passed 2026-11-11).
5. **SF-0232-05 - Clarify destructive confirmations.** **Acceptance:** Consequence and scope stated before commit. **Required verification:** Cancel safety tests. **Implementation:** Implemented; each destructive action states its consequence and scope before it commits, and Cancel keeps the thing; table in docs/engineering/flow-cross-cutting.md; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/engineering/flow-cross-cutting.md` Destructive confirmations; `web/src/views/Drafts.test.tsx` 'confirms before deleting, preserves the draft on cancel and supports Undo', 'keeps the delete confirmation and error visible when the server rejects the deletion'; `web/src/views/Library.test.tsx` 'shows exact current flags before confirming a batch edit', 'refuses a confirmed batch action if a different filter takes over while the dialog is open', 'cancels active playback replacement without building, and guards the confirmed build'; all passed 2026-11-10.
6. **SF-0232-06 - Protect focus and announcements.** **Acceptance:** No unexpected modal or speech spam. **Required verification:** Keyboard/NVDA review. **Implementation:** In progress; Needs a person: an NVDA review that nothing speaks too often or opens unasked. Automated part passed 2026-11-10: `web/src/ui/toastsCoalesce.test.tsx`, `web/src/ui/toastPriority.test.tsx`, `web/src/ui/controls.test.tsx` 'never shows more than a few at once', 'restores focus to the active page after a confirmed Undo removes its button'; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0232-07 - Handle stale async responses.** **Acceptance:** Old success cannot overwrite current failure or revision. **Required verification:** Race E2E. **Implementation:** In progress; built `web/src/state/sfStaleAsync.test.tsx` (a late old success never covers a newer failure, for a retry and for a newer revision) against the existing guard in `web/src/state/async.ts`; not yet run because of laptop load, and the race E2E (`web/e2e/sf-flow-create.e2e.ts` 'SF-0224-03', `web/e2e/finishing.e2e.ts` 'a slow search can’t replace a newer one') was not rerun this session; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0232-08 - Measure recovery success.** **Acceptance:** People restore a failed edit or job correctly. **Required verification:** Fault-injection user study. **Implementation:** Not started; Needs a person: a fault-injection user study of people restoring a failed edit or job; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0138/0182/0163; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
