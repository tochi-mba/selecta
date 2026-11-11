# ADR-0073: Rendering performance, 20k-track scale, 100-song edits and animation budgets

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 0 of 8 tasks implemented with automated evidence on 2026-11-11; 0 need a person; 8 still open (7 built with a browser check pending)
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0017, ADR-0029, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Selecta runs CPU-intensive audio analysis and background rendering beside a React interface. A visually rich redesign can increase layout cost, JS work and memory pressure exactly when audio reliability matters most.

## Decision proposed

Profile before optimizing, set measurable interactive responsiveness budgets and enforce layout stability with realistic workloads. Preserve audio scheduling over decorative animation. Virtualization, code splitting and worker offloading are chosen only with evidence and accessibility tests.

## Experience and frontend architecture

- Build reproducible heavy fixtures: 20k library, 100-song editor, 64 Studio cells, long lyric views and active background analysis. Measure on recorded supported hardware using production builds, including constrained CPU and disk pressure.

- Use Core Web Vitals INP <=200ms and CLS <=0.1 as external reference targets when applicable, but record local methodology and do not conflate lab synthetic results with 75th percentile real-user field metrics. Define app-specific time-to-interaction and input-delay budgets with baselines before setting release thresholds.

- Stop hidden/reduced-motion visualizers, avoid unnecessary row remounts, memoize only based on measured bottlenecks and keep large async data/animation out of audio control state. Lazy-load heavy workspaces only if navigation remains smooth.

## Detailed implementation work

1. **S3-0073-01 - In progress.** Capture baseline bundle, memory, mount, navigation, interaction and audio timing measurements. **Status:** Implemented; browser check pending (web/e2e/s3-0073-baseline-and-memory.e2e.ts 'S3-0073-01 baseline: bundle, heap, DOM, first mount and navigation for every page', written 2026-11-11, writes one record of bundle size, JS heap, DOM size, first mount and navigation per page). Interaction, layout-shift and audio-timing numbers already exist (web/e2e/s3-profiles.e2e.ts S3-PROFILE lines, docs/adr/selecta-microinteraction-performance-results.md). Needs a person: record the baseline on the owner's documented hardware.
2. **S3-0073-02 - Implemented.** Create deterministic 20k-library, 100-song-timeline, 64-cell Studio and background-load fixtures. **Status:** Implemented; browser check pending (web/e2e/s3-profiles.e2e.ts 'S3-0057-08 a 100-song timeline...' and 'S3-0059-08 the Studio grid answers within budget during a background render...', web/e2e/mp-0289-stem-studio.e2e.ts 'MP-0289-01 ... all 64 cells line up'). The 20k library with background analysis writes is proven: tests/test_s3_library_profile.py test_twenty_thousand_songs_page_quickly_while_analysis_writes_in_the_background and tests/test_library_edges.py test_twenty_thousand_songs_are_all_reachable_and_a_page_stays_quick (passed 2026-11-11); tests/scale_server.py builds 20k songs with a 100-song mix.
3. **S3-0073-03 - Implemented.** Profile long-list and panel interactions before deciding on virtualization or state architecture changes. **Status:** Implemented; browser check pending (web/e2e/s3-profiles.e2e.ts panel profiles for the 100-song timeline and the Studio grid). The long-list profile ran: tests/test_s3_library_profile.py pages 20k songs idle and under background writes and prints both profiles (passed 2026-11-11); docs/adr/completion/performance.md records the decision it guards (pagination, not virtualization).
4. **S3-0073-04 - Implemented.** Define frame/interaction budgets and layout-shift acceptance based on measured devices. **Status:** Implemented; browser check pending (web/e2e/mp-0298-responsive-and-a11y.e2e.ts 'MP-0298-06 (lab part) layout shift, largest paint and interaction delay stay inside budget' and web/e2e/s3-profiles.e2e.ts, which enforce INP 200 ms, CLS 0.1 and no long task over 200 ms). Budgets are written in docs/adr/completion/performance.md; the 20k server budget is enforced by tests/test_s3_library_profile.py (passed 2026-11-11). Needs a person: confirm the budgets against measurements on the owner's documented hardware.
5. **S3-0073-05 - Implemented.** Audit spectrum/lyrics animations under hidden tabs, reduced motion and low power. **Status:** Implemented; browser check pending (web/e2e/mp-0296-motion.e2e.ts 'MP-0296-06 Still and reduced motion remove decorative movement while the music data keeps updating' and 'MP-0296-07 the visualizer draws at most 15 frames a second while playing and nothing while hidden'). Needs a person: a low-power (battery saver) device check.
6. **S3-0073-06 - In progress.** Optimize loading splits and render boundaries without altering audio scheduling semantics. **Status:** In progress: Lucy, Cloud and the admin area are lazily loaded chunks (web/src/App.tsx, web/src/RuntimeApp.tsx, web/src/cloud/CloudApp.tsx; seen in the 2026-11-11 vite build) and seam scheduling is unchanged (web/src/audio/transportEdges.test.ts), but no before-and-after load measurement shows an optimisation
7. **S3-0073-07 - Implemented.** Run memory/cleanup tests for repeated Studio, inspectors, overlays and preview mounts. **Status:** Implemented; browser check pending (web/e2e/s3-0073-baseline-and-memory.e2e.ts 'S3-0073-07 repeated Studio, inspector, preview, palette and route mounts leave nothing growing', written 2026-11-11: after a warm-up, 12 rounds may not keep growing the garbage-collected heap, DOM nodes or event listeners, read through the browser's DevTools protocol). Unmount cleanup is unit-tested: web/src/ui/useVisiblePoll.test.tsx, web/src/audio/mediaSession.test.ts, web/src/audio/focus.test.tsx 'leaving the page lets the sound go'.
8. **S3-0073-08 - In progress.** Track performance regression thresholds in CI where deterministic and manually when hardware-specific. **Status:** Implemented for the deterministic part; browser check pending (MP-0298-06, web/e2e/s3-profiles.e2e.ts, web/e2e/s3-0073-baseline-and-memory.e2e.ts run in the Edge E2E job of .github/workflows/test.yml); tests/test_s3_library_profile.py runs in the Python job (passed 2026-11-11). Needs a person: the hardware-specific manual measurements.

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
