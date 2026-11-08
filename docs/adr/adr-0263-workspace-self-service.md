# ADR-0263 - Workspace self-service recovery and privacy-safe diagnostics

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0229, ADR-0230, ADR-0232, ADR-0238; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/WorkshopPanels.tsx`; `web/src/views/Start.tsx`.

## Context and evidence boundary

Workspace already exposes sources, storage and job states; non-developer recovery from environment, missing model, disk or server failures needs precise causal guidance.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

For detected faults, show affected operation, verified cause, scoped retry and recovery confirmation. Optionally copy an explicitly reviewed local diagnostic summary with paths and music metadata redacted; no auto-shell commands or upload.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 0/8 Implemented, 0/8 independently Verified

1. **GP-0263-01 - Catalogue actual environment, scan, worker and export failures.** **Acceptance:** Catalogue actual environment, scan, worker and export failures is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
2. **GP-0263-02 - Distinguish verified cause from speculative diagnosis.** **Acceptance:** Distinguish verified cause from speculative diagnosis is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
3. **GP-0263-03 - Never confuse offline server with genuinely empty Library.** **Acceptance:** Never confuse offline server with genuinely empty Library is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
4. **GP-0263-04 - Provide scoped retry and cancel without deleting other work.** **Acceptance:** Provide scoped retry and cancel without deleting other work is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
5. **GP-0263-05 - Allowlist privacy-safe copied diagnostic fields.** **Acceptance:** Allowlist privacy-safe copied diagnostic fields is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
6. **GP-0263-06 - Explain only detected local dependency requirements.** **Acceptance:** Explain only detected local dependency requirements is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
7. **GP-0263-07 - Return to interrupted task without unexpected autoplay.** **Acceptance:** Return to interrupted task without unexpected autoplay is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.
8. **GP-0263-08 - Measure nondeveloper fault recovery without coaching.** **Acceptance:** Measure nondeveloper fault recovery without coaching is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** failure fixtures, clipboard redaction audit and independent nondeveloper repair task; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** -.

## Negative cases and required evidence

**Area-specific:** server offline versus empty, missing ffmpeg/model, permission denial, full disk, sensitive file path

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0229, ADR-0230, ADR-0232, ADR-0238, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
