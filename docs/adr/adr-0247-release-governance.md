# ADR-0247 — Implementation-status integrity and independent GO/NO-GO governance

- **Decision:** Proposed (owner approval pending).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Delivery.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0184/0164/0030; historical statuses remain unmodified.
- **Existing source touchpoints:** docs/adr/README.md; docs/acceptance.md; web/playwright.config.ts.

## Context and evidence boundary

Every programme task independently tracks design acceptance, implemented code and verification. New programme status should not be summed with past ledgers or used to declare the current working product broken. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Every programme task independently tracks design acceptance, implemented code and verification. New programme status should not be summed with past ledgers or used to declare the current working product broken. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No self-verified release, unsupported green CI equivalence, historical status rewrite or premature GO. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist — 0/8 Implemented, 0/8 Verified

1. **SF-0247-01 — Define decision state transitions.** **Acceptance:** Proposed, Accepted, Rejected, Superseded documented with dates. **Required verification:** ADR governance audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **SF-0247-02 — Define implementation state transitions.** **Acceptance:** Not started/In progress/Implemented require source evidence. **Required verification:** Ledger check. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **SF-0247-03 — Define independent verification.** **Acceptance:** Reviewer, environment, media and SHA traceable. **Required verification:** Evidence template audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **SF-0247-04 — Set P0/P1/P2 rules.** **Acceptance:** Audio/data/privacy/access failures block release. **Required verification:** Failure triage review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **SF-0247-05 — Require full parity checks.** **Acceptance:** Every core feature maps to source and tested journey. **Required verification:** Feature parity matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **SF-0247-06 — Define visual sign-off protocol.** **Acceptance:** Candidate images separate from approved baselines. **Required verification:** Reviewer approval record. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **SF-0247-07 — Prove safe rollback.** **Acceptance:** Old/current/new state preserved without migration loss. **Required verification:** Rollback E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
8. **SF-0247-08 — Publish final release verdict.** **Acceptance:** No GO without signed exact-SHA gate and music evaluation. **Required verification:** Independent release report. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0184/0164/0030; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Proposed; 0/8 Implemented, 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
