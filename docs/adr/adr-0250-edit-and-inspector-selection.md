# ADR-0250 - Edit and Inspector selection arbitration

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (4/8 Implemented, 0/8 In progress, 4/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P0 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0219, ADR-0220, ADR-0221, ADR-0232; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Mix.tsx`; `web/src/views/EditorRows.tsx`; `web/src/views/SeamInspector.tsx`.

## Context and evidence boundary

An Edit screenshot gives similarly strong emphasis to a selected song, a seam, render progress and a fallback explanation. Stable underlying IDs already exist.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Make one edit object the primary focus, show related objects as context, and separate Hear seam, Play song and Play mix. Merge redundant status copy without concealing actual technique fallback or revision authority.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 4/8 Implemented, 0/8 independently Verified

1. **GP-0250-01 - Define selected song versus selected seam visual ownership.** **Acceptance:** Define selected song versus selected seam visual ownership is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** b858971 (wip, feat/finish-checklists); **Evidence:** web/src/views/Mix.tsx selection owner (song or transition, never both); web/src/views/gp-0250-selection.test.tsx 'GP-0250-01/02 a selected song and a selected transition never share the highlight' (vitest, passed 2026-11-10).
2. **GP-0250-02 - Highlight only the logical primary edit target.** **Acceptance:** Highlight only the logical primary edit target is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** b858971 (wip, feat/finish-checklists); **Evidence:** web/src/views/gp-0250-selection.test.tsx 'GP-0250-01/02 a selected song and a selected transition never share the highlight' (exactly one highlighted target and the matching This song / This transition inspector; vitest, passed 2026-11-10).
3. **GP-0250-03 - Label distinct song, seam and whole-mix audition actions.** **Acceptance:** Label distinct song, seam and whole-mix audition actions is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** b858971 (wip, feat/finish-checklists); **Evidence:** Hear it carries 'Plays only the transition from X into Y', plus distinct Play from Song N and Play from the top; web/src/views/gp-0250-selection.test.tsx 'GP-0250-03 song, transition and whole-mix auditions each say what they play' (vitest, passed 2026-11-10).
4. **GP-0250-04 - Explain desired, prepared and actual transition in one status hierarchy.** **Acceptance:** Explain desired, prepared and actual transition in one status hierarchy is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
5. **GP-0250-05 - Keep selected object visible through inspector scroll and resize.** **Acceptance:** Keep selected object visible through inspector scroll and resize is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** b858971 (wip, feat/finish-checklists); **Evidence:** web/src/views/Mix.tsx scrolls the selected row back into view after the inspector resizes; web/src/views/gp-0250-selection.test.tsx 'GP-0250-05 resizing the inspector brings the selected row back into view without moving focus' (vitest, passed 2026-11-10).
6. **GP-0250-06 - Preserve exact occurrence/pair IDs after reorder or deletion.** **Acceptance:** Preserve exact occurrence/pair IDs after reorder or deletion is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
7. **GP-0250-07 - Reject stale inspector and preview responses safely.** **Acceptance:** Reject stale inspector and preview responses safely is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
8. **GP-0250-08 - Validate correct seam selection and audition with creators.** **Acceptance:** Validate correct seam selection and audition with creators is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** reorder/race E2E, real audition and independent creator test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** -; **Evidence:** Needs a person: independent creator test of seam selection and real audition.

## Negative cases and required evidence

**Area-specific:** duplicate song occurrences, reorder, locked seam, pending preview, 100-song list

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0219, ADR-0220, ADR-0221, ADR-0232, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 4/8 Implemented, 0/8 In progress, 4/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
