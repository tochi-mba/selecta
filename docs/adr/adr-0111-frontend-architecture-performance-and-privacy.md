# ADR-0111: Frontend module boundaries, CSS performance, 20k/100-song scale and local-first privacy

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
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

## Detailed implementation work — all Not started

1. **S4-0111-01 — Document component/domain ownership and import boundaries.** Acceptance: App.tsx complexity reduced incrementally without duplicated stores. Required verification: Dependency diagram and tests. **Implementation: Not started; Verified: No.**
2. **S4-0111-02 — Separate persistent player state from route composition.** Acceptance: Theme/route/overlay re-render cannot stop playback. Required verification: Transport continuity E2E. **Implementation: Not started; Verified: No.**
3. **S4-0111-03 — Inventory API responses and version compatibility.** Acceptance: Missing fields produce honest unsupported states, not fake success. Required verification: Old-server feature detection and contract tests. **Implementation: Not started; Verified: No.**
4. **S4-0111-04 — Audit CSS layering and component specificity regressions.** Acceptance: No expensive blanket override cascade or unrelated changes. Required verification: Stylelint/static check and visual diffs. **Implementation: Not started; Verified: No.**
5. **S4-0111-05 — Profile 20k Library search/filter/deep refresh.** Acceptance: Input responsiveness and memory meet measured budget. Required verification: Hardware/version controlled performance traces. **Implementation: Not started; Verified: No.**
6. **S4-0111-06 — Profile 100-song Editor reorder/selection/scroll.** Acceptance: No long main-thread stall or focus loss. Required verification: Performance and keyboard task under workload. **Implementation: Not started; Verified: No.**
7. **S4-0111-07 — Profile full 64-cell Studio and simultaneous analysis/render.** Acceptance: Cell toggle and preview respond smoothly without audio dropout. Required verification: Real-machine memory/frame/audio trace. **Implementation: Not started; Verified: No.**
8. **S4-0111-08 — Control fast lyric/visualizer updates and hidden work.** Acceptance: No global per-frame React rerender, reduced motion supported. Required verification: Profiler, offscreen and animation testing. **Implementation: Not started; Verified: No.**
9. **S4-0111-09 — Preserve browser preference and local recovery migration.** Acceptance: Invalid/blocked storage cannot crash or erase durable backend data. Required verification: Malformed values, quota, rollback test. **Implementation: Not started; Verified: No.**
10. **S4-0111-10 — Audit local-first privacy, diagnostics and added asset requests.** Acceptance: No new remote tracking/artwork or original-file write without separate review. Required verification: Network activity/redaction/Host-Origin security tests. **Implementation: Not started; Verified: No.**

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

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
