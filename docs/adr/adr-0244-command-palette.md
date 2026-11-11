# ADR-0244 - Search-first navigation and expert command palette continuity

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (1/8 Implemented, 4/8 In progress, 3/8 Not started; 2026-11-10).
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

## Implementation checklist - 1/8 Implemented, 0/8 Verified

1. **SF-0244-01 - Audit existing commands.** **Acceptance:** Every command maps to real capability and permission. **Required verification:** Palette inventory. **Implementation:** In progress; `web/src/shell/paletteInventory.test.ts` (every Go to lands on a real page, every other command runs a real handler, unavailable commands say why) exists from an earlier round but was not rerun this session because of laptop load; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0244-02 - Redesign search hierarchy.** **Acceptance:** Songs, mixes, routes and actions clearly differentiated. **Required verification:** Results task study. **Implementation:** In progress; Needs a person: a results task study of whether songs, mixes, routes and actions are told apart; results are grouped Songs, Go to, Playback, Do and Your drafts in `web/src/shell/commands.ts`; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0244-03 - Protect focused inputs.** **Acceptance:** Shortcuts never interrupt text editing. **Required verification:** Keyboard regression. **Implementation:** In progress; built `web/src/state/sfTypingKeys.test.ts` (every shortcut key and chord is ignored in text, search, number, text area, select and rich editors, and still works from the page); not yet run because of laptop load; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0244-04 - Show contextual actions.** **Acceptance:** Commands indicate which mix and draft affected. **Required verification:** Scope fixtures. **Implementation:** Implemented; Undo and draft commands name the exact mix or draft they affect, and refuse when it is not loaded; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/shell/commands.test.ts` 'names the exact mix for Undo and refuses unloaded draft actions'; `web/src/ui/CommandPalette.test.tsx` 'shows exact Undo scope but refuses an unavailable mutation'; passed 2026-11-10.
5. **SF-0244-05 - Handle stale search results.** **Acceptance:** Old results cannot trigger wrong object action. **Required verification:** Race tests. **Implementation:** In progress; `web/src/ui/paletteStale.test.tsx` (an older answer that lands late is never shown or chosen) exists from an earlier round but was not rerun this session because of laptop load; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0244-06 - Preserve focus restoration.** **Acceptance:** Opening/closing returns focus predictably. **Required verification:** NVDA/keyboard test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0244-07 - Scale large library lookup.** **Acceptance:** Results remain performant at 20k songs. **Required verification:** Stress profile. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0244-08 - Evaluate expert speed.** **Acceptance:** Frequent tasks measurably faster without novice confusion. **Required verification:** Comparative study. **Implementation:** Not started; Needs a person: a comparative study of expert speed against novice confusion; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0139/0167/0153; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 1/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
