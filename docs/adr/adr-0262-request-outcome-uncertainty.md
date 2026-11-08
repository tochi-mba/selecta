# ADR-0262 — Request waiting uncertainty and promised outcomes

- **Decision:** Proposed (explicit owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0225, ADR-0232, ADR-0237; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Requests.tsx`; `web/src/views/Now.tsx`.

## Context and evidence boundary

Requests already have waiting, considering and preparing states and atomic bridge consent. Users may still confuse an accepted request with a song guaranteed to play soon.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Show requested versus actually scheduled, the known reason for waiting, precise recording and real next user action; never invent ETA, queue position or pressure to approve a bridge.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist — 0/8 Implemented, 0/8 independently Verified

1. **GP-0262-01 — Define requested, considering, awaiting and placed semantics.** **Acceptance:** Define requested, considering, awaiting and placed semantics is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
2. **GP-0262-02 — State unknown schedule plainly without fabricated countdown.** **Acceptance:** State unknown schedule plainly without fabricated countdown is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
3. **GP-0262-03 — Preserve exact requested recording artist/version identity.** **Acceptance:** Preserve exact requested recording artist/version identity is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
4. **GP-0262-04 — Expose only server-supported cancel or approval actions.** **Acceptance:** Expose only server-supported cancel or approval actions is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
5. **GP-0262-05 — Maintain explicit all-or-nothing bridge consent.** **Acceptance:** Maintain explicit all-or-nothing bridge consent is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
6. **GP-0262-06 — Suppress nonactionable repetitive request notifications.** **Acceptance:** Suppress nonactionable repetitive request notifications is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
7. **GP-0262-07 — Keep Listen and Requests lifecycle information consistent.** **Acceptance:** Keep Listen and Requests lifecycle information consistent is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
8. **GP-0262-08 — Test listener understanding of guaranteed versus tentative.** **Acceptance:** Test listener understanding of guaranteed versus tentative is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** status fixtures, atomic joining E2E and listener prediction study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.

## Negative cases and required evidence

**Area-specific:** multiple requests, missing track, duplicate title, changed mix, canceled bridge

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0225, ADR-0232, ADR-0237, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Proposed; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
