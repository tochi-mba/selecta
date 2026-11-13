# ADR-0244 - Search-first navigation and expert command palette continuity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 2/8 In progress, 1/8 Not started or needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Shell.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0139/0167/0153; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/ui/CommandPalette.tsx; web/src/shell/Shell.tsx; web/src/views/Library.tsx.

## Context and evidence boundary

Preserve the command palette and fast library lookup as power-user complements to the editorial scenes, with exact context, stable focus and clearly identified action scope. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Preserve the command palette and fast library lookup as power-user complements to the editorial scenes, with exact context, stable focus and clearly identified action scope. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No keyboard shortcut stealing from text inputs, unconfirmed mix activation or search results pretending to be ready songs. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0244-01 - Audit existing commands.** **Acceptance:** Every command maps to real capability and permission. **Required verification:** Palette inventory. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/shell/paletteInventory.test.ts` 'sends every Go to command to a page that exists', 'runs the app’s own handler, or saves a local preference, for every other command', 'says why a command can’t run, instead of hiding it or running it anyway' (vitest 2026-11-11).
2. **SF-0244-02 - Redesign search hierarchy.** **Acceptance:** Songs, mixes, routes and actions clearly differentiated. **Required verification:** Results task study. **Implementation:** In progress; Needs a person: a results task study of whether songs, mixes, routes and actions are told apart; results are grouped Songs, Go to, Playback, Do and Your drafts in `web/src/shell/commands.ts`. Automated part passed 2026-11-12: `web/src/ui/sfPaletteHierarchy.test.tsx` 'shows each kind under its own named group, songs first, and says the kind before each name', 'keeps two results with the same name apart by their kind and their visible group line' (2 passed, vitest); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0244-03 - Protect focused inputs.** **Acceptance:** Shortcuts never interrupt text editing. **Required verification:** Keyboard regression. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/state/sfTypingKeys.test.ts` 'every shortcut key does nothing while a text field, text area, list or rich editor has focus', 'the same keys still work from the page, so the guard is what stops them' (vitest 2026-11-11).
4. **SF-0244-04 - Show contextual actions.** **Acceptance:** Commands indicate which mix and draft affected. **Required verification:** Scope fixtures. **Implementation:** Implemented; Undo and draft commands name the exact mix or draft they affect, and refuse when it is not loaded; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/shell/commands.test.ts` 'names the exact mix for Undo and refuses unloaded draft actions'; `web/src/ui/CommandPalette.test.tsx` 'shows exact Undo scope but refuses an unavailable mutation'; passed 2026-11-10.
5. **SF-0244-05 - Handle stale search results.** **Acceptance:** Old results cannot trigger wrong object action. **Required verification:** Race tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/ui/paletteStale.test.tsx` 'ignores an older answer that lands after the newer one', 'shows nothing from an answer that arrives after the words changed' (vitest 2026-11-11).
6. **SF-0244-06 - Preserve focus restoration.** **Acceptance:** Opening/closing returns focus predictably. **Required verification:** NVDA/keyboard test. **Implementation:** In progress; Needs a person: an NVDA check of what is announced when the palette opens and closes. Automated keyboard part passed 2026-11-11: `web/src/ui/sfPaletteFocus.test.tsx` 'opening focuses the search field, and Escape gives focus back to the opener', 'running a command with Enter closes it and gives focus back to the opener', 'the close button gives focus back to the opener too, and Tab stays inside while open' (3 passed); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0244-07 - Scale large library lookup.** **Acceptance:** Results remain performant at 20k songs. **Required verification:** Stress profile. **Implementation:** Implemented; the palette asks for at most 8 songs per search and drops late answers, and the 20,000-song stress profile keeps relevance and its p95 latency limit; **Verified:** No; **Owner:** Claude agent r4a; **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `tests/test_gp_music_search.py::test_gp_0251_08_relevance_and_p95_latency_on_twenty_thousand_songs` (passed 2026-11-11, 8.6 s); `web/src/ui/paletteStale.test.tsx` (passed 2026-11-11); `web/src/ui/paletteSongs.ts`.
8. **SF-0244-08 - Evaluate expert speed.** **Acceptance:** Frequent tasks measurably faster without novice confusion. **Required verification:** Comparative study. **Implementation:** Not started; Needs a person: a comparative study of expert speed against novice confusion; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0139/0167/0153; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-11); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
