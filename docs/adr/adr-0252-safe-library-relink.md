# ADR-0252 - Non-destructive file relocation and Library re-link

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P0 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0227, ADR-0230, ADR-0238; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `src/selecta/library/scan.py`; `src/selecta/db.py`; `web/src/views/WorkshopPanels.tsx`.

## Context and evidence boundary

Source scanning records file paths and missing tracks; user-controlled re-linking after drive or root-folder relocation has separate recording-identity and data-safety requirements.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Offer explicit local re-link preview with conservative identity verification, consent for collisions, atomic updates and preserved project associations. Never alter or upload original music.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 0/8 Implemented, 0/8 independently Verified

1. **GP-0252-01 - Distinguish temporarily disconnected sources from removed tracks.** **Acceptance:** Distinguish temporarily disconnected sources from removed tracks is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
2. **GP-0252-02 - Define verifiable candidate matches beyond title equality.** **Acceptance:** Define verifiable candidate matches beyond title equality is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
3. **GP-0252-03 - Preview affected folders, songs and references before commit.** **Acceptance:** Preview affected folders, songs and references before commit is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
4. **GP-0252-04 - Require user confirmation for ambiguous identity matches.** **Acceptance:** Require user confirmation for ambiguous identity matches is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
5. **GP-0252-05 - Ensure cancelled or failed remaps are atomic.** **Acceptance:** Ensure cancelled or failed remaps are atomic is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
6. **GP-0252-06 - Preserve ratings, draft references and analysis on correct IDs.** **Acceptance:** Preserve ratings, draft references and analysis on correct IDs is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
7. **GP-0252-07 - Prevent path traversal, remote leakage or audio-file modification.** **Acceptance:** Prevent path traversal, remote leakage or audio-file modification is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
8. **GP-0252-08 - Demonstrate independent full moved-folder recovery.** **Acceptance:** Demonstrate independent full moved-folder recovery is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** real folder move, collision negatives, SQLite transaction and path-security tests; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.

## Negative cases and required evidence

**Area-specific:** unmounted drive, collision of same titles, symlink, partial scan, cancellation

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0227, ADR-0230, ADR-0238, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 0/8 Implemented, 0/8 In progress, 8/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
