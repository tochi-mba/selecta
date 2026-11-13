# ADR-0256 - Contextual music terms and safe discoverable guidance

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started).
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

## Implementation checklist - 7/8 Implemented, 0/8 independently Verified

1. **GP-0256-01 - List specialist terms and ambiguous actions across all routes.** **Acceptance:** List specialist terms and ambiguous actions across all routes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** web/src/ui/glossaryTerms.ts (38 terms); web/src/ui/Glossary.test.tsx 'GP-0256-01 every ? hint on every route names a term the glossary explains' (vitest, passed 2026-11-10).
2. **GP-0256-02 - Explain each action's effect, scope and reversible limit.** **Acceptance:** Explain each action's effect, scope and reversible limit is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** web/src/ui/Glossary.test.tsx 'GP-0256-02 every term that describes an action says what it changes and whether it can be taken back' (vitest, passed 2026-11-10).
3. **GP-0256-03 - Make a searchable local glossary reachable from controls.** **Acceptance:** Make a searchable local glossary reachable from controls is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** web/src/ui/Glossary.tsx searchable Music terms dialog reached from every ? hint; web/src/ui/Glossary.test.tsx 'GP-0256-03/04 a ? opens a short answer by keyboard or tap, and leads to the searchable glossary at that term' (vitest, passed 2026-11-10).
4. **GP-0256-04 - Provide touch, keyboard and screen-reader help parity.** **Acceptance:** Provide touch, keyboard and screen-reader help parity is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** ? hints are buttons with aria-expanded and aria-controls, Escape returns focus; web/src/ui/Glossary.test.tsx 'GP-0256-03/04 a ? opens a short answer by keyboard or tap, and leads to the searchable glossary at that term' (vitest, passed 2026-11-10); a screen-reader session is left to Verified.
5. **GP-0256-05 - Explain requested, proposed, rendered and heard distinctly.** **Acceptance:** Explain requested, proposed, rendered and heard distinctly is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** web/src/ui/Glossary.test.tsx 'GP-0256-05 requested, planned, rendered and heard are four separate explanations that point at each other' (vitest, passed 2026-11-10).
6. **GP-0256-06 - Teach Studio and requests without performing mutations.** **Acceptance:** Teach Studio and requests without performing mutations is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** Studio terms (stems, studio-lane, studio-cell, solo, suggestion, applied) and request terms (request, bridge) are static text in web/src/ui/glossaryTerms.ts; web/src/ui/Glossary.test.tsx 'GP-0256-03/04 ...' asserts reading and searching made no server call (vitest, passed 2026-11-10).
7. **GP-0256-07 - Allow expert dismissal without suppressing critical warnings.** **Acceptance:** Allow expert dismissal without suppressing critical warnings is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 4b0f247 (wip, feat/finish-checklists); **Evidence:** prefs.termHints toggle; web/src/ui/Glossary.test.tsx 'GP-0256-07 experts can hide the ? hints, and the glossary and every warning stay' (vitest, passed 2026-11-10).
8. **GP-0256-08 - Test first-time advanced-task success without coaching.** **Acceptance:** Test first-time advanced-task success without coaching is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** content audit, touch/NVDA tests and novice uncoached tasks; relevant negative-case and exact-SHA source tests. **Implementation:** Needs a person: run the uncoached first-time advanced-task study (cards A1 to A3) with at least 5 novices, and score it with gp_study.py; **Verified:** No; **Owner:** Checklist agent rc-gp (2026-11-12); **Implementing PR/SHA:** src/selecta/audit/gp_study.py and docs/research/gp-research-protocol.md, added 2026-11-12 in wip a7501f13 (feat/finish-checklists-2); **Evidence:** study kit built: docs/research/gp-research-protocol.md section (GP-0256-08) scripts the cohorts, neutral cards and measures, and src/selecta/audit/gp_study.py scores the result sheet per cohort (privacy allowlist, participant codes only, 95% Wilson interval, no conclusion without a signed threshold); tests/test_gp_research_protocol.py (4 passed) and tests/test_gp_study.py (19 passed) (2026-11-12).

## Negative cases and required evidence

**Area-specific:** touch-only, keyboard focus, screen reader, 400% zoom, expert repeat use

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0221, ADR-0242, ADR-0246, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 7/8 Implemented, 0/8 In progress, 1/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
