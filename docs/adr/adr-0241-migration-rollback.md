# ADR-0241 - Incremental scene migration, compatibility and reversible release slices

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Delivery.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0164/0184/0030; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/shell/Shell.tsx; web/src/router.ts; web/src/state/prefs.ts.

## Context and evidence boundary

Ship the new artistic language in separately reversible components without leaving incompatible old and new data models. Rollback must retain user mixes, requests, prefs, local paths and export history. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Ship the new artistic language in separately reversible components without leaving incompatible old and new data models. Rollback must retain user mixes, requests, prefs, local paths and export history. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No big-bang rewrite, silent data migration, missing legacy route or loss of playback state when toggling a redesigned scene. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0241-01 - Specify migration sequence.** **Acceptance:** Visual foundation then shell then music scenes and operations. **Required verification:** Dependency plan. **Implementation:** Implemented; the roadmap's delivery phases run visual foundation and components, then navigation and the persistent player, then music scenes, then operations; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/selecta-flow-roadmap.md` Delivery phases; `tests/test_flow_cross_cutting.py` 'test_the_rollout_order_goes_foundation_then_shell_then_scenes_then_operations' (passed 2026-11-10).
2. **SF-0241-02 - Define compatibility boundaries.** **Acceptance:** Old URLs and backend APIs remain intact. **Required verification:** Router and API tests. **Implementation:** Implemented; older addresses open the same pages as their replacements and are written back as the current one, and the older API shapes still answer; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/sfCompat.test.ts` (3 tests, vitest passed 2026-11-11); `tests/test_api_contract_fixtures.py`, `tests/test_api_contracts.py` 'test_the_older_list_still_answers_as_it_did', 'test_older_pages_that_do_not_say_still_work' (passed 2026-11-11).
3. **SF-0241-03 - Plan reversible UI switches.** **Acceptance:** Rollback does not change stored media or mix formats. **Required verification:** Feature switch test. **Implementation:** Implemented; switching a feature off is the rollback switch and leaves stored media, the mix and drafts unchanged; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_release_safety.py` (2 passed 2026-11-10).
4. **SF-0241-04 - Preserve preferences and state.** **Acceptance:** Old to new to old retains selected mix and motion/theme prefs. **Required verification:** Persistence E2E. **Implementation:** Implemented; the selected mix lives on the server and reads the same in the current build, the Flow baseline build and the current build again; prefs written by the baseline build read correctly here, and saving now keeps choices this build doesn't know, so new to old to new no longer drops motion; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/state/prefsRollback.test.ts` (4 tests, the baseline c3715b14 prefs reader and writer pinned) with `web/src/state/prefs.ts` setPrefs keeping unknown keys; `tests/rollback_check.py` against c3715b14 source: 'identical across all three' on 2026-11-11; Vitest 9 files 71 passed 2026-11-11.
5. **SF-0241-05 - Avoid duplicated ownership.** **Acceptance:** Single player and edit model during phased rollout. **Required verification:** Architecture review. **Implementation:** Implemented; one module makes the mix's sound (plus the Studio preview engine), every preview asks the one audio focus first, and one module owns local addresses, so a phased rollout cannot add a second player; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_cross_cutting.py` 'test_transport_and_routes_each_have_one_owner' (passed 2026-11-11); `web/e2e/mi-player-stability.e2e.ts` 'MI-0140-08 every route, dialog, sheet and the command palette leave one AudioContext running and the sound unbroken' (passed 2026-11-11).
6. **SF-0241-06 - Require narrow PR boundaries.** **Acceptance:** Each release slice has explicit contracts and tests. **Required verification:** PR review checklist. **Implementation:** Implemented; every PR states the ADR tasks it moves, its tests and its evidence record; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `.github/pull_request_template.md`; `tests/test_flow_cross_cutting.py` 'test_every_pull_request_carries_its_evidence_record' (passed 2026-11-10).
7. **SF-0241-07 - Exercise failure rollback.** **Acceptance:** Forced revert after edit/request/export is safe. **Required verification:** Scenario E2E. **Implementation:** Implemented; a forced revert is safe: a home with a draft edit, a seam change, a tempo correction, a waiting and a cancelled request, two rated seams and a finished export's job record and file is read identically by this build, by the Flow baseline build and by this build again; switching features off and on rewrites nothing; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `tests/rollback_check.py` run against `git archive c3715b14 src`: 'identical across all three', exit 0, 2026-11-11; `tests/test_flow_release_safety.py` (2 passed 2026-11-11). The export record is the one a finished export writes; no fresh render was made in this run.
8. **SF-0241-08 - Record release candidate SHA.** **Acceptance:** Gate decision pinned to exact source and evidence. **Required verification:** Release record. **Implementation:** Not started; Needs a person: a release record pinning the gate decision to an exact candidate SHA and evidence, signed by the owner; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0164/0184/0030; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
