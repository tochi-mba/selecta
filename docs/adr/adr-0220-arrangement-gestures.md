# ADR-0220 - Tactile song reorder and selectable seam objects with revision safety

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (6/8 Implemented, 0/8 In progress, 2/8 needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0150/0173/0100; no earlier status changed.
- **Existing source touchpoints:** web/src/views/EditorRows.tsx; web/src/views/Mix.tsx.

## Context and evidence boundary

Give songs clear movable identity and transition edges explicit selection. Pointer gestures are provisional until server acknowledgement, with full keyboard parity and stable song occurrence IDs. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Give songs clear movable identity and transition edges explicit selection. Pointer gestures are provisional until server acknowledgement, with full keyboard parity and stable song occurrence IDs. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No optimistic phantom save, lost duplicate song identity, accidental drag or unannounced rejection. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist - 6/8 Implemented, 0/8 Verified

1. **SF-0220-01 - Redesign song rows.** **Acceptance:** Title, sequence, lock and metadata readable. **Required verification:** Long-mix screenshots. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mix.test.tsx` 'keeps duplicate, RTL and CJK song names readable and occurrence-scoped'; `web/e2e/finishing.e2e.ts` 'long, right-to-left and duplicate names stay readable and whole at the smallest size' (2026-11-10).
2. **SF-0220-02 - Make seam edge an object.** **Acceptance:** From/to identities and state selectable. **Required verification:** Pair identity test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mix.test.tsx` 'opens beside the timeline, for the two songs it's between', 'plays the exact render, and the same stays selected when others move', 'never confuses two different drafts with identical songs and transition keys' (2026-11-10).
3. **SF-0220-03 - Specify pointer drag preview.** **Acceptance:** Provisional insertion and cancel visibly distinct. **Required verification:** Pointer E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-flow-create.e2e.ts` 'SF-0220-03 a touch drag previews the insertion, a cancel leaves nothing, and a drop moves it'; run 2026-11-11 (dist-r3j).
4. **SF-0220-04 - Support keyboard reorder.** **Acceptance:** Move actions and focus predictable. **Required verification:** Keyboard/NVDA test. **Implementation:** Needs a person: NVDA test of reorder announcements. Automated part: `web/e2e/finishing.e2e.ts` 'reordering with the keyboard moves the song, and focus stays on it' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0220-05 - Preserve locked positions.** **Acceptance:** Protected sections cannot mutate silently. **Required verification:** Lock fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r2k; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `src/selecta/mix.py` locked_in_the_way + `src/selecta/routes/edit.py` /api/mix/move refuses (409) a move that would shift a locked song; `tests/test_sf_flow_locks.py` (4 passed: refused and unchanged, moves that leave it in place work, moving the locked song itself keeps its lock, drafts guarded); `web/src/views/sfFlowEditor.test.tsx` 'says why a move past a locked song did nothing, and leaves every row where it was'; `tests/test_mix.py` lock/move tests (5 passed) (2026-11-10).
6. **SF-0220-06 - Commit with revision guards.** **Acceptance:** Server reject rolls back exact order. **Required verification:** Conflict/Undo E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/flows.e2e.ts` 'a change to a mix that's moved on stops, says so, and touches nothing', 'editing: move with the buttons, undo it, and remove a song'; `tests/test_api_contracts.py::test_a_change_to_a_mix_that_has_moved_on_stops` (2026-11-10).
7. **SF-0220-07 - Handle hundred-song list.** **Acceptance:** Scrolling and focus remain stable under load. **Required verification:** Stress test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-flow-create.e2e.ts` 'SF-0220-07 a hundred-song mix keeps scrolling and focus steady while songs move'; run 2026-11-11 (dist-r3j).
8. **SF-0220-08 - Measure edit confidence.** **Acceptance:** Users reorder intended song without errors. **Required verification:** Creator study. **Implementation:** Needs a person: creator study of reorder confidence; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0150/0173/0100 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted; 6/8 Implemented (2026-11-11); 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
