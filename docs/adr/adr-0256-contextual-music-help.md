# ADR-0256 — Contextual music terms and safe discoverable guidance

- **Decision:** Proposed (explicit owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0221, ADR-0242, ADR-0246; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Studio.tsx`; `web/src/views/SeamInspector.tsx`; `web/src/shell/commands.ts`.

## Context and evidence boundary

Expert labels such as stem, seam, bridge, vocal ride and frozen revision may require DJ knowledge despite existing shortcut help and microcopy ADRs.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Provide optional just-in-time definitions near advanced controls and a findable local glossary. Clarify effect, scope and reversibility without forced tours, synthetic music or unintended actions.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist — 0/8 Implemented, 0/8 independently Verified

1. **GP-0256-01 — List specialist terms and ambiguous actions across all routes.** **Acceptance:** List specialist terms and ambiguous actions across all routes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
2. **GP-0256-02 — Explain each action's effect, scope and reversible limit.** **Acceptance:** Explain each action's effect, scope and reversible limit is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
3. **GP-0256-03 — Make a searchable local glossary reachable from controls.** **Acceptance:** Make a searchable local glossary reachable from controls is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
4. **GP-0256-04 — Provide touch, keyboard and screen-reader help parity.** **Acceptance:** Provide touch, keyboard and screen-reader help parity is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
5. **GP-0256-05 — Explain requested, proposed, rendered and heard distinctly.** **Acceptance:** Explain requested, proposed, rendered and heard distinctly is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
6. **GP-0256-06 — Teach Studio and requests without performing mutations.** **Acceptance:** Teach Studio and requests without performing mutations is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
7. **GP-0256-07 — Allow expert dismissal without suppressing critical warnings.** **Acceptance:** Allow expert dismissal without suppressing critical warnings is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
8. **GP-0256-08 — Test first-time advanced-task success without coaching.** **Acceptance:** Test first-time advanced-task success without coaching is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.

## Negative cases and required evidence

**Area-specific:** touch-only, keyboard focus, screen reader, 400% zoom, expert repeat use

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0221, ADR-0242, ADR-0246, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Proposed; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
