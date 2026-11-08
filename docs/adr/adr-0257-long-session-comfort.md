# ADR-0257 — Long-session visual comfort and notification budget

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0205, ADR-0210, ADR-0232, ADR-0235; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/ui/toasts.tsx`; `web/src/ui/ActivityPanel.tsx`; `web/src/state/prefs.ts`.

## Context and evidence boundary

Theme and Still/Subtle/Expressive preferences exist, but cumulative glare, busy status text and routine notification cost over a long music session need separate evidence.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Interrupt the foreground only for actionable blockers; keep routine job updates in Activity. Evaluate low-light contrast, screen-reader chatter and visualizer resource use over sustained real-audio sessions.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist — 0/8 Implemented, 0/8 independently Verified

1. **GP-0257-01 — Count foreground toasts and motion changes by severity.** **Acceptance:** Count foreground toasts and motion changes by severity is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
2. **GP-0257-02 — Define noncritical versus critical interruption rules.** **Acceptance:** Define noncritical versus critical interruption rules is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
3. **GP-0257-03 — Condense repeat status explanations without hiding details.** **Acceptance:** Condense repeat status explanations without hiding details is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
4. **GP-0257-04 — Assess dark/light contrast and low-light fatigue.** **Acceptance:** Assess dark/light contrast and low-light fatigue is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
5. **GP-0257-05 — Measure hidden/Still visualizer CPU resource use.** **Acceptance:** Measure hidden/Still visualizer CPU resource use is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
6. **GP-0257-06 — Limit nonessential live-region announcements.** **Acceptance:** Limit nonessential live-region announcements is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
7. **GP-0257-07 — Ensure quiet jobs and important failures remain discoverable.** **Acceptance:** Ensure quiet jobs and important failures remain discoverable is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.
8. **GP-0257-08 — Run sustained-session listener and DJ comfort research.** **Acceptance:** Run sustained-session listener and DJ comfort research is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** attention-event trace, long-session human comfort and performance/audio test; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence:** —.

## Negative cases and required evidence

**Area-specific:** multi-hour playback, frequent background jobs, NVDA live regions, battery devices

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0205, ADR-0210, ADR-0232, ADR-0235, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 8/8 Not started; 0 Verified; no implementing PR/SHA. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
