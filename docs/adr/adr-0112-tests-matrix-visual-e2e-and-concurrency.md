# ADR-0112: Full regression strategy, stable test fixtures, visual review and adversarial races

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 0–12 Verification
- **Extends, does not automatically supersede:** ADR-0029, ADR-0074, ADR-0075, ADR-0088
- **Source surfaces to reconcile:** `web/src/**/*.test.tsx`; `web/e2e/*.e2e.ts`; `tests/*.py`; `.github/workflows/test.yml`
- **Tasks:** S4-0112-01 through S4-0112-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Tests must assert actual contract rather than old CSS shape. Screenshot capture without reviewed baselines, real audio and human task tests does not prove an experience safe or polished.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Build a feature-to-test traceability matrix with a layered suite: static/API/unit/component/integrated/E2E/visual/accessibility/performance/real audio/human acceptance. Preserve existing tests and justify any replacement before removal.

## Experience, frontend and interaction specification

- Synthetic fixtures: empty, exactly six ready, typical, 20k Library, 100-song mix, 64-cell Studio, broken files, delayed server, old server, duplicate/RTL metadata.
- Approved screenshot baselines in both themes, device groups and meaningful states; never mass-accept changed baselines.
- Model-based/property invariants: one audio owner, wrong-scope writes impossible, atomic bridge, exact export snapshot, latest intent.
- Exact CI head SHA, runner version and manual evidence recorded separately.

## Detailed implementation work — all Not started

1. **S4-0112-01 — Inventory all prior Python, Web, audio and Edge tests and contracts.** Acceptance: No behavioural assertion silently dropped due to selector change. Required verification: File-by-file old-to-new test mapping. **Implementation: Not started; Verified: No.**
2. **S4-0112-02 — Create deterministic fixtures for small/large/error/race states.** Acceptance: Fixtures independent and avoid private user music. Required verification: Isolated server/data setup and seeded media checks. **Implementation: Not started; Verified: No.**
3. **S4-0112-03 — Establish component interaction/state suite for shared controls.** Acceptance: Every default/focused/pressed/busy/error variant covered. Required verification: Unit, component, keyboard tests. **Implementation: Not started; Verified: No.**
4. **S4-0112-04 — Expand transport/audio-focus and player lifecycle regression.** Acceptance: No unintended overlap/stop/resume across every preview owner. Required verification: Pairwise player-owner matrix and real-media checks. **Implementation: Not started; Verified: No.**
5. **S4-0112-05 — Expand current/draft/editor/request/export concurrency suite.** Acceptance: No wrong pair, duplicate join, partial bridge or wrong FLAC. Required verification: Sequences A–J in verification matrix. **Implementation: Not started; Verified: No.**
6. **S4-0112-06 — Promote screenshot captures to reviewed golden comparisons.** Acceptance: Each intended diff approved and stored with fixture metadata. Required verification: Playwright toHaveScreenshot pinned browser. **Implementation: Not started; Verified: No.**
7. **S4-0112-07 — Run automated WCAG checks plus manual AT acceptance.** Acceptance: Axe pass not misreported as manual conformance. Required verification: Per-route axe + NVDA/Edge session logs. **Implementation: Not started; Verified: No.**
8. **S4-0112-08 — Measure large-data performance and export audio bytes.** Acceptance: 20k/100-song/64 cell and decodable snapshot-accurate FLAC. Required verification: Performance traces and audio decode assertions. **Implementation: Not started; Verified: No.**
9. **S4-0112-09 — Require negative/offline/recovery/old server fixtures.** Acceptance: Failed, stale, interrupted and recovered visibly distinct. Required verification: Fault injection including timeout/duplicate response. **Implementation: Not started; Verified: No.**
10. **S4-0112-10 — Publish CI matrix, flakes, quarantine policy and evidence links.** Acceptance: No broad test skip/update of failing snapshot to force green. Required verification: Exact-head checks, flake owner and PR review. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- CSS selector change may require test update but must not remove asserted behaviour.
- CI test run not equivalent to real NVDA or music listening.
- Screenshots should never include user's private filenames/paths without approval.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Large fixture and manual testing costs increase but reduce regressions at integration boundaries.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0112 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

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
