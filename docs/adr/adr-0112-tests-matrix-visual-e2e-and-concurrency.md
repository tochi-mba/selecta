# ADR-0112: Full regression strategy, stable test fixtures, visual review and adversarial races

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (8/10 implemented, 2 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
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

## Detailed implementation work

1. **S4-0112-01 - Inventory all prior Python, Web, audio and Edge tests and contracts.** Acceptance: No behavioural assertion silently dropped due to selector change. Required verification: File-by-file old-to-new test mapping. **Implementation: Implemented (2026-11-12); Verified: Claude (owner-delegated 2026-11-12).** Evidence: src/selecta/audit/suite_inventory.py writes docs/adr/completion/s4-0112-test-inventory.md and .json: all 65 baseline (9b663f9) test files and 1,386 tests mapped to now (1,383 kept by name, 0 moved, 3 not found by name and listed for review); tests/test_s4_0112_suite_inventory.py 4/4 passed 2026-11-12. **Verified:** Claude (owner-delegated 2026-11-12): a delegated review of the three 'not found by name' tests in docs/adr/completion/s4-0112-test-inventory.md, by git history: finishing.e2e.ts 'a chosen theme is there from the first paint' was renamed and widened in 495df7c2 to 'a manual theme and browser chrome agree before app JavaScript, even when the OS disagrees' (same check plus the title-bar colour); Drafts.test.tsx 'deleting asks nothing, and can be undone' became 'confirms before deleting, preserves the draft on cancel and supports Undo' in 93e66106 (a deliberate change to ask first; the Undo assertion is kept); RequestsJoining.test.tsx 'says when it's joining' became 'does not promise joining before the next valid opening' in 7a630f02 (deliberate copy change for S4-0103-10). All three renamed or replaced, no behavioural assertion dropped; tests/test_s4_0112_suite_inventory.py passed 2026-11-12.
2. **S4-0112-02 - Create deterministic fixtures for small/large/error/race states.** Acceptance: Fixtures independent and avoid private user music. Required verification: Isolated server/data setup and seeded media checks. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: tests/e2e_server.py synthetic library (SELECTA_E2E_STRESS for awkward names), tests/synth.py, tests/scale_server.py; no private music. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read tests/e2e_server.py, tests/synth.py and tests/scale_server.py: every song is synthesized, homes are temporary, no real music path is read; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
3. **S4-0112-03 - Establish component interaction/state suite for shared controls.** Acceptance: Every default/focused/pressed/busy/error variant covered. Required verification: Unit, component, keyboard tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: web/src/ui/controls.test.tsx; docs/adr/completion/components.md interaction state matrix. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read web/src/ui/controls.test.tsx against the state matrix in docs/adr/completion/components.md; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
4. **S4-0112-04 - Expand transport/audio-focus and player lifecycle regression.** Acceptance: No unintended overlap/stop/resume across every preview owner. Required verification: Pairwise player-owner matrix and real-media checks. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: focus.test.tsx; listen.e2e.ts 'a preview takes the sound', 'only one tab plays at a time'. Needs a person: real-media pairwise owner matrix.
5. **S4-0112-05 - Expand current/draft/editor/request/export concurrency suite.** Acceptance: No wrong pair, duplicate join, partial bridge or wrong FLAC. Required verification: Sequences A–J in verification matrix. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/e2e/integration.e2e.ts draft vs current, two requests, late cancel, export pinned to revision. Claude check (owner-delegated 2026-11-12): reran web/e2e/integration.e2e.ts in Edge 157 on the shared laptop 2026-11-12: two requests at once, the late cancel, the export pinned to its revision and the correction test passed; 'editing a draft while the current mix plays' and 'saving a draft as a file while another mix is reordered' failed only waiting for renders (allRendered 280 s timeout under load, 3 and 2 transitions still rendering). Needs a person: rerun those two integration tests on an idle machine and review the A-J sequences; pass = all pass
6. **S4-0112-06 - Promote screenshot captures to reviewed golden comparisons.** Acceptance: Each intended diff approved and stored with fixture metadata. Required verification: Playwright toHaveScreenshot pinned browser. **Implementation: Implemented (2026-11-12); Verified: No.** Evidence: web/e2e/s4-0112-golden.e2e.ts captures 16 candidates (4 views, 375/1280 px, light/dark) with fixture, browser, theme, viewport and commit, and pixel-compares only views a person approved; src/selecta/audit/golden_promote.py is the only writer of docs/verification/goldens/s4-0112/approved.json and refuses a reviewer without a full name, a missing device, or a SHA other than the capture's; 4/4 browser tests passed 2026-11-12 (16 captured, 0 compared, none approved yet); tests/test_s4_0112_golden_promotion.py 9/9 passed 2026-11-12. Needs a person: a named reviewer looks at the 16 candidates from web/e2e/s4-0112-golden.e2e.ts on one commit, runs `python -m selecta.audit.golden_promote` for each approved image and adds a row to docs/adr/completion/visual-evidence.md; pass = approved.json lists those views with reviewer, date, device and SHA, and the next run compares them.
7. **S4-0112-07 - Run automated WCAG checks plus manual AT acceptance.** Acceptance: Axe pass not misreported as manual conformance. Required verification: Per-route axe + NVDA/Edge session logs. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: pages.e2e.ts axe on pages, dialogs and drawers. Claude check (owner-delegated 2026-11-12): one NVDA 2026.3.1 + Edge session log (docs/verification/claude-checks/selecta-4-implementation-checklist/nvda/nvda-2026.3.1-session-1.txt); axe clean on the inspector, Studio, list editor, Song Details, More sheet and harmonic page except the Requests option name mismatch noted under S4-0110-05. Needs a person: the full NVDA/Edge session logs per docs/verification/at-session-log.md
8. **S4-0112-08 - Measure large-data performance and export audio bytes.** Acceptance: 20k/100-song/64 cell and decodable snapshot-accurate FLAC. Required verification: Performance traces and audio decode assertions. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: test_export_validation.py decode; test_library_edges.py 20k. Needs a person: performance traces.
9. **S4-0112-09 - Require negative/offline/recovery/old server fixtures.** Acceptance: Failed, stale, interrupted and recovered visibly distinct. Required verification: Fault injection including timeout/duplicate response. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: flows.e2e.ts 'it says so, keeps what's on screen, and recovers by itself', 'a change that couldn't be sent says so'; jobs.test.ts old server; test_api_contracts.py 'guarded_replay_returns_original_response_after_its_own_mix_change'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read flows.e2e.ts offline cases, jobs.test.ts old-server case and test_api_contracts.py 'guarded_replay_returns_original_response_after_its_own_mix_change'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
10. **S4-0112-10 - Publish CI matrix, flakes, quarantine policy and evidence links.** Acceptance: No broad test skip/update of failing snapshot to force green. Required verification: Exact-head checks, flake owner and PR review. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/ci.md CI matrix and new 'Flakes and quarantine'; new tests/test_no_quarantined_tests.py. Needs a person: flake owner and exact-head PR review.

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
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (8/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |
| 2026-11-12 | Accepted | Implemented (10/10) | Not verified | Automatable parts of the person-step tasks built and run 2026-11-12; every task still needs a person or independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
