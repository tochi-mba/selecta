# ADR-0208 - Intent navigation and contextual scene continuity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Shell.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0115/0139/0167; no historical status is changed.
- **Existing source touchpoints:** web/src/shell/Shell.tsx; web/src/shell/manifest.ts; web/src/router.ts.

## Context and evidence boundary

Listen, Explore, Create, Library and Workspace should be easy to find without rewriting backend route semantics. Preserve deep links, exact selection and focused context. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Listen, Explore, Create, Library and Workspace should be easy to find without rewriting backend route semantics. Preserve deep links, exact selection and focused context. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No implicit draft activation, navigation-triggered audio or lost selected seam. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0208-01 - Map old and proposed routes.** **Acceptance:** All destinations reachable and named. **Required verification:** Route parity tests. **Implementation:** Implemented; every route has an address that parses back to it, older addresses still work, and unknown ones say so; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/router.test.tsx` 'every page's address leads back to it'; `web/src/shell/mpSurfaceInventory.test.ts`; `web/e2e/pages.e2e.ts` 'addresses that go nowhere say so'; run 2026-11-10.
2. **SF-0208-02 - Design desktop navigation.** **Acceptance:** Music intentions prioritised, Workspace quiet. **Required verification:** Findability study. **Implementation:** Not started; Needs a person: a findability study of desktop navigation; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0208-03 - Design mobile navigation.** **Acceptance:** No obstructed persistent player or controls. **Required verification:** Touch E2E. **Implementation:** Implemented; on phones the bottom bar and mini-player never overlap and nothing pressable is hidden behind them; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'the mini-player and bottom bar never overlap, and the last row can always be reached'; `web/e2e/pages.e2e.ts` 'on a phone, nothing you can press sits half hidden behind the player, at any height'; run 2026-11-10.
4. **SF-0208-04 - Preserve deep links and history.** **Acceptance:** Back/Forward and refresh safe. **Required verification:** Router test. **Implementation:** Implemented; Back, Forward and refresh keep the page, filters and open draft; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/router.test.tsx` 'moving around' (4 tests); `web/e2e/pages.e2e.ts` 'Back and Forward go where they should', 'reloading any page stays on it', 'the Library's filters are part of its address'; run 2026-11-10.
5. **SF-0208-05 - Maintain selected creative context.** **Acceptance:** Mix, seam, query and inspector persist. **Required verification:** State E2E. **Implementation:** Implemented; the open draft and Library query live in the address, and each mix scope keeps its selected song or seam (and its inspector) across route changes; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/Mix.test.tsx` 'keeps each mix scope's exact selection separate when the mounted editor switches scope'; `web/src/App.test.tsx` 'opens from the list without touching the current mix, and stays open after a reload'; `web/e2e/pages.e2e.ts` 'the Library's filters are part of its address'; run 2026-11-10.
6. **SF-0208-06 - Define focus/scroll restoration.** **Acceptance:** Keyboard and AT context survives navigation. **Required verification:** NVDA test. **Implementation:** Not started; Needs a person: an NVDA session on focus and scroll restoration; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0208-07 - Prototype optional scene transitions.** **Acceptance:** Unsupported API gets instant fallback. **Required verification:** Feature detection test. **Implementation:** Not started; routes reveal with a CSS animation (polish.css route-reveal, off under reduced motion); no View Transitions API prototype with feature detection exists yet; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0208-08 - Validate no audio side effects.** **Acceptance:** Route changes never restart transport. **Required verification:** Audio owner regression. **Implementation:** Implemented; moving between pages never starts, stops or restarts sound; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/listen.e2e.ts` 'moving around the app leaves the music alone, and the mini-player follows'; run 2026-11-10.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0115/0139/0167 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
