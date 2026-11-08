# ADR-0073: Rendering performance, 20k-track scale, 100-song edits and animation budgets

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0017, ADR-0029, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0073-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Selecta runs CPU-intensive audio analysis and background rendering beside a React interface. A visually rich redesign can increase layout cost, JS work and memory pressure exactly when audio reliability matters most.

## Decision proposed

Profile before optimizing, set measurable interactive responsiveness budgets and enforce layout stability with realistic workloads. Preserve audio scheduling over decorative animation. Virtualization, code splitting and worker offloading are chosen only with evidence and accessibility tests.

## Experience and frontend architecture

- Build reproducible heavy fixtures: 20k library, 100-song editor, 64 Studio cells, long lyric views and active background analysis. Measure on recorded supported hardware using production builds, including constrained CPU and disk pressure.

- Use Core Web Vitals INP <=200ms and CLS <=0.1 as external reference targets when applicable, but record local methodology and do not conflate lab synthetic results with 75th percentile real-user field metrics. Define app-specific time-to-interaction and input-delay budgets with baselines before setting release thresholds.

- Stop hidden/reduced-motion visualizers, avoid unnecessary row remounts, memoize only based on measured bottlenecks and keep large async data/animation out of audio control state. Lazy-load heavy workspaces only if navigation remains smooth.

## Detailed implementation work (all Not started)

1. **S3-0073-01 - Not started.** Capture baseline bundle, memory, mount, navigation, interaction and audio timing measurements.
2. **S3-0073-02 - Not started.** Create deterministic 20k-library, 100-song-timeline, 64-cell Studio and background-load fixtures.
3. **S3-0073-03 - Not started.** Profile long-list and panel interactions before deciding on virtualization or state architecture changes.
4. **S3-0073-04 - Not started.** Define frame/interaction budgets and layout-shift acceptance based on measured devices.
5. **S3-0073-05 - Not started.** Audit spectrum/lyrics animations under hidden tabs, reduced motion and low power.
6. **S3-0073-06 - Not started.** Optimize loading splits and render boundaries without altering audio scheduling semantics.
7. **S3-0073-07 - Not started.** Run memory/cleanup tests for repeated Studio, inspectors, overlays and preview mounts.
8. **S3-0073-08 - Not started.** Track performance regression thresholds in CI where deterministic and manually when hardware-specific.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Repeated filtering/search over 20k items, long Edit reorder/Undo, many draft cards.
- Audio processing active while editing; no dropped or unintended audio events.
- Rapid modal open/close, preview lifecycle, route navigation and 400% zoom with no memory leak.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Virtualize every list immediately: may improve raw row count but introduces keyboard/focus complexity. Selective evidence-driven optimization is safer.

## Acceptance and evidence

Recorded representative hardware meets defined responsiveness budgets without reduced audio integrity, accessibility or visual stability.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
