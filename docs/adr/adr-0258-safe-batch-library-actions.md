# ADR-0258 — Exact-scope batch Library operations

- **Decision:** Proposed (explicit owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0226, ADR-0227, ADR-0232; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Library.tsx`; `src/selecta/routes/library.py`.

## Context and evidence boundary

Per-song controls and scalable paging exist; repeated collection management could benefit from multi-select, but demand and exact scope must be proved before adding mutations.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Research repetitive tasks first. If justified, expose selected page versus result-set semantics, preview stable song IDs and use safe server operations with honestly reversible Undo, never modifying source audio.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist — 0/8 Implemented, 0/8 independently Verified

1. **GP-0258-01 — Research real demand for multi-song operations.** **Acceptance:** Research real demand for multi-song operations is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
2. **GP-0258-02 — Define selected page, loaded rows and whole-query scope.** **Acceptance:** Define selected page, loaded rows and whole-query scope is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
3. **GP-0258-03 — Provide accessible checkbox and range selection.** **Acceptance:** Provide accessible checkbox and range selection is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
4. **GP-0258-04 — Preview exact affected song IDs before any operation.** **Acceptance:** Preview exact affected song IDs before any operation is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
5. **GP-0258-05 — Specify atomic or explicit per-item failure outcomes.** **Acceptance:** Specify atomic or explicit per-item failure outcomes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
6. **GP-0258-06 — Protect original music files from batch updates.** **Acceptance:** Protect original music files from batch updates is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
7. **GP-0258-07 — Offer Undo only for actually reversible state changes.** **Acceptance:** Offer Undo only for actually reversible state changes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
8. **GP-0258-08 — Prove efficiency and responsiveness with 20k tracks.** **Acceptance:** Prove efficiency and responsiveness with 20k tracks is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** selection keyboard/NVDA tests, transactional API tests and task-efficiency comparison; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.

## Negative cases and required evidence

**Area-specific:** stale filters, duplicate titles, 20k results, concurrent scans, partial errors

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0226, ADR-0227, ADR-0232, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Proposed; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
