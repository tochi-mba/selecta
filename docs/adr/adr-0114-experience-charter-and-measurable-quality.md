# ADR-0114 - Experience-first product charter and measurable quality

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (2026-11-10: EX-0114-01 and -03 Implemented, -02 and -04 In progress, -05 Not started; see the checklist for evidence); **Independent verification:** No (0/5; uncoached tasks, protocol review, map sign-off and release decision need a person).
- **Date:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Related:** ADR-0089 and ADR-0113; these are neither automatically superseded nor retroactively completed.
- **Sources:** `web/src/App.tsx`, `web/src/shell/manifest.ts`, `docs/adr/selecta-4-roadmap.md`.

## Context and problem

Selecta supports listeners, creators and expert editors, but a feature-complete interface is not necessarily understandable. Prior 4.0 status documents were written before merged PR #29 and therefore are not reliable proof of the current UI. This new programme questions actual information hierarchy and interaction design rather than treating prior visual decisions as binding. A source audit is not a human usability study.

## Proposed decision

1. Adopt **listening effortless, making mixes expressive, detailed editing precise, operations quiet** as the north star.
2. Model a listener, creator and expert task journey: intent, first action, completion, confusion, error and recovery.
3. Re-design navigation, listening hierarchy and workflows when supported by evidence; do not assume decorative polishing alone is sufficient.
4. Preserve all capabilities and routes; playback, audio files, current/draft scope, revision guards, request consent, Studio, FLAC and local privacy are safety invariants.
5. Separate **decision Proposed/Accepted**, **implementation Not started/In progress/Implemented** and **independent verification No/Yes**. Documentation changes never mark code done.

## Options and tradeoffs

Retaining all current layouts minimizes disruption but misses structural opportunities. Rebuilding the entire application at once raises severe risk to player and state identity. Choose reversible vertical slices with observed user-task comparisons; a new concept is rejected if it performs worse.

## Consequences and acceptance

More up-front research and scoped review are needed. Never weaken regression assertions to make new UI pass. Each change must preserve keyboard access and demonstrate route/audio continuity, appropriate real audio, accessibility and recovery. All targets are proposals, not measured outcomes.

## Implementation tasks (status per task below, 2026-11-11)

1. **EX-0114-01 - Inventory end-to-end user journeys.** Acceptance: listener, creator and expert goals have action/error/recovery maps. Verification: route/control/API inspection and uncoached baseline tasks. **Implementation: Implemented (2026-11-10); Verified: No. Needs a person: uncoached baseline tasks.**
2. **EX-0114-02 - Reconcile current main against prior programmes.** Acceptance: PR #29 and older S4 task claims separated from implemented source. Verification: exact SHA, merged diff and task evidence crosswalk. **Implementation: In progress (2026-11-10); Verified: No. Needs a person: owner review of the S4/EX crosswalk.**
3. **EX-0114-03 - Set measurable quality criteria.** Acceptance: clear user task success, confidence, error and recovery metrics with denominators. Verification: research protocol review. **Implementation: Implemented (2026-11-10); Verified: No. Needs a person: research protocol review.**
4. **EX-0114-04 - Define every feature's preservation owner.** Acceptance: no action, route or persisted state silently disappears. Verification: old/new feature map and E2E coverage. **Implementation: In progress (2026-11-10); Verified: No. Needs a person: owner sign-off of the old/new map.**
5. **EX-0114-05 - Gate small reversible implementation slices.** Acceptance: each implementing PR includes named owner, verification and rollback. Verification: actual PR evidence and final release decision. **Implementation: Not started; Verified: No. Needs a person: per-PR owner/rollback evidence and release decision.**

## References and status

[Research on progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [human-AI guidelines](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [4.0 feature parity](selecta-4-feature-parity.md). See [new roadmap](selecta-experience-roadmap.md), [implementation checklist](selecta-experience-implementation-checklist.md), [evidence ledger](selecta-experience-evidence.md) and [reconciliation](selecta-experience-status-reconciliation.md). Pattern references do not establish Selecta user-test results.
