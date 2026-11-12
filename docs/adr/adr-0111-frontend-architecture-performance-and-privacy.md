# ADR-0111: Frontend module boundaries, CSS performance, 20k/100-song scale and local-first privacy

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (7/10 implemented, 3 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1–11 Cross-cutting
- **Extends, does not automatically supersede:** ADR-0025, ADR-0026, ADR-0028, ADR-0071, ADR-0072, ADR-0073, ADR-0087
- **Source surfaces to reconcile:** `web/src/App.tsx`; `web/src/state/*`; `web/src/styles/*.css`; `web/src/player.ts`; `.github/workflows/test.yml`
- **Tasks:** S4-0111-01 through S4-0111-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A redesign that swaps route, state framework, player and CSS simultaneously creates unmanageable correctness risks. Frequent visualizer/poll updates may degrade typing, editor and audio responsiveness.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Refactor UI around shell, feature composition, domain controllers and reusable primitives without prematurely replacing React, API or audio engine. Measure performance with deterministic 20k Library/100-song Editor/64-cell Studio fixtures and preserve local-first security.

## Experience, frontend and interaction specification

- Application bootstrap/routing/shell are separate from audio ownership and domain mutations; page components only present authorized state.
- Use stable selectors to avoid every playback tick rerendering Library or nav; canvas animation stops when hidden or reduced motion.
- Lazy load specialist routes only after measuring bundle tradeoffs; avoid network dependencies for visual polish.
- Version UI preferences and test migration; retain old routes and backend feature detection rather than assumed fields.

## Detailed implementation work

1. **S4-0111-01 - Document component/domain ownership and import boundaries.** Acceptance: App.tsx complexity reduced incrementally without duplicated stores. Required verification: Dependency diagram and tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/adr/completion/architecture.md; new web/src/importBoundaries.test.ts. Needs a person: independent review.
2. **S4-0111-02 - Separate persistent player state from route composition.** Acceptance: Theme/route/overlay re-render cannot stop playback. Required verification: Transport continuity E2E. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/player.ts outside React; listen.e2e.ts 'moving around the app leaves the music alone'; finishing.e2e.ts 'changing the theme while playing starts nothing again'. Needs a person: independent review.
3. **S4-0111-03 - Inventory API responses and version compatibility.** Acceptance: Missing fields produce honest unsupported states, not fake success. Required verification: Old-server feature detection and contract tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: jobs.test.ts 'never crashes the app for an incomplete status from a different server version'; ExportJobs.tsx unsupported state; tests/test_api_contracts.py 'status_says_what_this_server_can_do'. Needs a person: independent review.
4. **S4-0111-04 - Audit CSS layering and component specificity regressions.** Acceptance: No expensive blanket override cascade or unrelated changes. Required verification: Stylelint/static check and visual diffs. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/adr/completion/css-ownership.md; web/src/styles/css-ownership.test.ts, spacing-tokens.test.ts, typography.test.ts. Needs a person: visual diff review.
5. **S4-0111-05 - Profile 20k Library search/filter/deep refresh.** Acceptance: Input responsiveness and memory meet measured budget. Required verification: Hardware/version controlled performance traces. **Implementation: In progress (2026-11-12); Verified: No.** Evidence: web/bench/s4-0111-scale.bench.ts 'S4-0111-05 a 20,000-song Library: search, filter, deep paging and a refresh at depth, with memory' run 2026-11-12 against tests/scale_server.py 20000 100, 1 run, failed 2 of 7 budgets: keys painted within 16 ms, filter 47 ms, Show more 40 ms, scroll p95 50 ms, JS heap 29.5 MB after 1,000 rows (budget 200), but search settled in 4,253 ms (budget 1,500) and a refresh at depth showed rows in 4,799 ms (budget 3,000); readings in docs/adr/completion/s4-0111-performance-traces.md. Needs a person: a hardware- and version-controlled trace of the same bench on a named, otherwise idle machine, and a decision on the missed search and refresh budgets; pass = every S4-0111-05 budget met there, or the owner accepts the miss in writing.
6. **S4-0111-06 - Profile 100-song Editor reorder/selection/scroll.** Acceptance: No long main-thread stall or focus loss. Required verification: Performance and keyboard task under workload. **Implementation: Implemented (2026-11-12); Verified: No.** Evidence: web/bench/s4-0111-scale.bench.ts 'S4-0111-06 a 100-song Editor: selection, keyboard reorder and scroll keep focus without long stalls' 1/1 passed 2026-11-12: 100 songs open in 4,903 ms, slowest selection 192 ms, 6 keyboard moves with focus kept (slowest 160 ms, no long task), scroll p95 50 ms; readings in docs/adr/completion/s4-0111-performance-traces.md; the throttled-CPU half is T0265 (web/e2e/t0265-constrained-profiles.e2e.ts). Needs a person: the same bench and a keyboard reorder of the 100-song Editor on a named, otherwise idle machine; pass = no interaction over 200 ms, no long task over 200 ms and focus never lost.
7. **S4-0111-07 - Profile full 64-cell Studio and simultaneous analysis/render.** Acceptance: Cell toggle and preview respond smoothly without audio dropout. Required verification: Real-machine memory/frame/audio trace. **Implementation: In progress (2026-11-12); Verified: No.** Evidence: web/bench/s4-0111-scale.bench.ts 'S4-0111-07 the 64-cell Studio answers while analysis and a render run and the main player plays' 1/1 passed 2026-11-12: with POST /api/analysis/start and /api/mix/render running, 16 Space toggles painted within 26.5 ms (Event Timing 128 ms), frame p95 16.7 ms, no long task, JS heap 31.3 MB; the main player plays through Web Audio, so no dropout was measured; docs/adr/completion/s4-0111-performance-traces.md. Needs a person: a real-machine memory, frame and audio trace of the 64-cell Studio with real stems while analysis and a render run and the mix plays through speakers; pass = no audible dropout and toggles under 200 ms.
8. **S4-0111-08 - Control fast lyric/visualizer updates and hidden work.** Acceptance: No global per-frame React rerender, reduced motion supported. Required verification: Profiler, offscreen and animation testing. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: useReducedMotion.test.tsx; web/src/views/spectrumVisuals.test.ts; finishing.e2e.ts 'the song is said once, and the clock never is'. Needs a person: profiler review.
9. **S4-0111-09 - Preserve browser preference and local recovery migration.** Acceptance: Invalid/blocked storage cannot crash or erase durable backend data. Required verification: Malformed values, quota, rollback test. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/state/prefs.ts; new web/src/state/prefs.test.ts 'browser preferences survive bad storage'; StudioSafety.test.tsx blocked-storage case; tests/test_local_upgrade.py, tests/test_upgrade.py. Needs a person: rollback exercise.
10. **S4-0111-10 - Audit local-first privacy, diagnostics and added asset requests.** Acceptance: No new remote tracking/artwork or original-file write without separate review. Required verification: Network activity/redaction/Host-Origin security tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: pages.e2e.ts 'the page only ever talks to this computer'; tests/test_api_contracts.py 'other_hosts_get_nothing', 'other_sites_can_not_change_anything'; tests/test_product.py 'api_refuses_changes_requested_by_another_website'; web/src/localPrivacyCopy.test.ts. Needs a person: separate security review.

## Required negative cases and regression strategy

- Unsupported backend version with new UI: show clear compatibility message.
- Baseline performance metrics must include OS/browser/hardware and avoid claiming production INP from lab trace.
- Backend, database, music-processing algorithms and dependencies stay out of initial UI scope.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Incremental refactor is slower than a single rewrite but keeps isolation, rollback and data integrity tractable.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0111 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |
| 2026-11-12 | Accepted | In progress (8/10) | Not verified | Automatable parts of the person-step tasks built and run 2026-11-12; every task still needs a person or independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
