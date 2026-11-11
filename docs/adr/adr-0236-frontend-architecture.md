# ADR-0236 - Modular frontend visual architecture and safe migration seams

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 0/8 In progress, 2/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Architecture.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0092/0164/0184; previous task/status evidence remains unchanged.
- **Existing source touchpoints:** web/src/App.tsx; web/src/shell/Shell.tsx; web/src/views/Now.tsx; web/src/styles/tokens.css.

## Context and evidence boundary

Refactor only where needed: isolate scene presentation, data provenance, player ownership, music objects and CSS responsibilities. Keep existing APIs and local server contracts stable, with small reversible implementation PRs. Source-level capabilities, this planning decision, code tests and independent acceptance are separate. Historical evidence remains at its original snapshot until separately reconciled against a future implementation SHA.

## Proposed decision

Refactor only where needed: isolate scene presentation, data provenance, player ownership, music objects and CSS responsibilities. Keep existing APIs and local server contracts stable, with small reversible implementation PRs. Keep one coherent audio-state truth and intentional user control. Require explicit source provenance and measurable acceptance for every interactive, accessibility and visual change.

## Visual, animation and microinteraction contract

- Every critical action remains discoverable, keyboard/touch operable and reversible where the backend permits.
- Planned versus prepared versus committed versus playing or failed states remain distinct with static and assistive-tech equivalents.
- All motion is causal, optional and non-blocking; the player and exact edit revisions win over display rendering.
- Design for both themes, high zoom, forced colors, reduced motion, long/RTL names, offline and slow/failed requests.

## Alternatives and trade-offs

No wholesale rewrite hiding regressions, no duplicated player state or source file beyond repository size limits. A new artistic effect is rejected if it reduces musical accuracy, accessibility, local privacy, performance or intelligible recovery. No production code or SaaS capability is authorized by a documentation-only ADR.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0236-01 - Map ownership boundaries.** **Acceptance:** Transport, route, scene, library and editor each have one owner. **Required verification:** Module dependency graph. **Implementation:** Implemented; one owner each: the main player (`web/src/player.ts`) and Studio preview (`web/src/studio.ts`) are the only AudioContexts, every other sound shares the one element in `web/src/audio/focus.ts` and asks it first, and only `web/src/router.ts` writes local addresses; library is `web/src/views/Library.tsx`, the editor `web/src/views/Mix.tsx`; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_cross_cutting.py` 'test_transport_and_routes_each_have_one_owner' (passed 2026-11-10); `docs/engineering/architecture.md`.
2. **SF-0236-02 - Define component seams.** **Acceptance:** Shared tokens/primitives avoid cross-screen coupling. **Required verification:** Architecture review. **Implementation:** Implemented; ui primitives, state and styles never import a page, and shared tokens live in `web/src/styles/tokens.css`; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_cross_cutting.py` 'test_shared_primitives_never_reach_into_a_screen' (passed 2026-11-10); `web/src/styles/tokens.css`.
3. **SF-0236-03 - Separate state and presentation.** **Acceptance:** Actual domain status remains source-of-truth. **Required verification:** Type/API tests. **Implementation:** Implemented; readiness, job and seam status come from the server and are only translated for display, never computed into a new truth; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/state/readiness.test.ts` (5 passed), `web/src/state/jobs.test.ts`, `web/src/state/polishReadinessDistinct.test.ts`; `tests/test_api_contract_fixtures.py` and `tests/test_api_contracts.py`; run 2026-11-10.
4. **SF-0236-04 - Plan CSS consolidation.** **Acceptance:** Tokens and page modules replace brittle overrides incrementally. **Required verification:** Cascade audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0236-05 - Preserve route and API contracts.** **Acceptance:** Existing deep links and endpoint shapes remain compatible. **Required verification:** Contract E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/sfCompat.test.ts` 'each older address opens exactly the page its replacement opens, never "missing"', 'older Workspace tab addresses open the same Workshop tab', 'where an older address lands, the address written back is the current one' (vitest 2026-11-11); endpoint shapes `tests/test_api_contract_fixtures.py` (passed 2026-11-11, earlier agent) and `tests/test_api_contracts.py` (all passed 2026-11-11).
6. **SF-0236-06 - Enforce source maintainability.** **Acceptance:** Code files under repo limit with coherent tests. **Required verification:** CI file-size and review checks. **Implementation:** Implemented; every code file is under the 1,000-line limit and checked in the suite; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_file_length.py` passed 2026-11-10.
7. **SF-0236-07 - Define reversible feature rollout.** **Acceptance:** New view can fall back without data migration. **Required verification:** Rollback test. **Implementation:** Implemented; a feature switched off and back on (or rolled back to core only) leaves music files, the current mix, drafts and requests as they were, with no data migration; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `tests/test_flow_release_safety.py` 'test_switching_every_optional_feature_off_and_back_changes_no_stored_music_or_mix', 'test_a_feature_switched_off_mid_session_keeps_what_it_saved' (passed 2026-11-10); cross-checkout `tests/rollback_check.py`.
8. **SF-0236-08 - Plan future-proof boundaries only.** **Acceptance:** Local data/storage interfaces do not add SaaS features. **Required verification:** Architecture acceptance review. **Implementation:** Not started; Superseded by ADR-0391: Selecta Cloud is now a goal; its no-SaaS clause holds only in local mode, and cloud storage and identity interfaces (ADR-0397, ADR-0392) were built on purpose; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Single player and intentional Pause; unchanged local music and explicit LRCLIB metadata disclosure; exact current/draft revisions and scoped Undo; stable song and seam IDs; consented atomic bridges; all eight stem lanes and 8–64 cells with recovery; truthful Library readiness; neutral blind research; and exact frozen-revision decodable FLAC remain protected. Verify slow/stale/offline/failure cases, multi-tab, touch, 320–2560px, 400% zoom, forced colors, reduced motion, NVDA/Edge and real-audio operation as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0092/0164/0184; new ADR-0198/0199 and previous programme acceptance records.
- **Next:** dated owner decision → design specimens → small code/test PR → separate independent human/AT/audio/performance report → explicit release gate.
- **Now:** Decision Accepted; Implementation 6/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
