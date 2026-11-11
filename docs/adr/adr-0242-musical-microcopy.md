# ADR-0242 - Music-native microcopy, state language and non-patronizing feedback

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (1/8 Implemented, 1/8 In progress, 6/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Content.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0138/0182/0159; historical statuses remain unmodified.
- **Existing source touchpoints:** web/src/views/Now.tsx; web/src/views/Mixes.tsx; web/src/views/Workshop.tsx.

## Context and evidence boundary

Use conversational but precise musical language. Simple user intent first, technical terms when necessary, and clear copy for unsaved, pending, applied, rendered, missing and failed outcomes. The codebase includes substantial existing source functionality; this record specifies new artistic and acceptance deltas and no newly implemented source behavior. Prior programme checkmarks require per-task reconciliation before reuse is credited.

## Proposed decision

Use conversational but precise musical language. Simple user intent first, technical terms when necessary, and clear copy for unsaved, pending, applied, rendered, missing and failed outcomes. Make decisions explicit and reversible when possible. Preserve music and source-data safety, locally controlled storage, genuine playback and exact draft/revision identity through all expressive presentation changes.

## Visual, animation and microinteraction contract

- Primary actions, status, identity and recovery remain visible with one focused music object per scene.
- Never conflate intended, pending, committed, prepared, rendered, heard or unknown states in copy, visuals or animations.
- Motion is causal, short, cancellable and optional. Reduced motion, forced colors, keyboard, touch and assistive technology preserve function.
- Test actual audio continuity and responsible CPU use wherever visual styling shares a thread with playback.

## Alternatives and trade-offs

No exaggerated intelligence claims, promise of guaranteed perfect transition or vague success when work is still processing. Preserve a proven reliable interface when a proposed artistic treatment cannot demonstrate improved user outcomes. This docs-only decision does not implement remote services, SaaS, telemetry, accounts or changes to music files.

## Implementation checklist - 1/8 Implemented, 0/8 Verified

1. **SF-0242-01 - Define voice and terminology.** **Acceptance:** Action nouns and music terms consistent across routes. **Required verification:** Content inventory. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0242-02 - Separate request and result labels.** **Acceptance:** Requested move never labeled rendered. **Required verification:** Status copy fixtures. **Implementation:** Implemented; a requested or proposed move is never labelled rendered or joined; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'never calls an automatic unrendered transition a confirmed technique', 'shows only returned ordered route songs, and never implies a proposed path has joined'; `web/src/views/Requests.test.tsx` 'says requested', 'says which request a bridge is for'; passed 2026-11-10.
3. **SF-0242-03 - Write truthful preparation states.** **Acceptance:** Scan/analyze/render/export text specific. **Required verification:** Async state review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0242-04 - Clarify action consequence.** **Acceptance:** Save, Play, Replace and Undo scopes explicit. **Required verification:** User prediction test. **Implementation:** In progress; Needs a person: a user prediction test of Save, Play, Replace and Undo scope. Automated part passed 2026-11-10: `web/src/ui/CommandPalette.test.tsx` 'shows exact Undo scope but refuses an unavailable mutation', `web/src/shell/commands.test.ts` 'names the exact mix for Undo and refuses unloaded draft actions'; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0242-05 - Develop precise error messages.** **Acceptance:** Cause and safe next action available. **Required verification:** Fault injection review. **Implementation:** Implemented; every built-in failure message names the cause and a safe next step: nothing answering, a server that broke (music and mixes are safe), a refusal without words, a read that hangs; the server's own reason is shown when it gives one and a conflict is told apart; a switched-off feature names the cause; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-11; **Evidence:** `web/src/apiFaults.test.ts` (6 fault-injection tests at the fetch boundary); `web/src/state/feedbackTaxonomy.test.tsx` 'tells a conflict from a failure, a missing thing, a refusal and a stopped server'; Vitest run 2026-11-11.
6. **SF-0242-06 - Support compact labels.** **Acceptance:** Narrow screens retain meaning and accessible names. **Required verification:** 320px/AT checks. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0242-07 - Audit multilingual and RTL support.** **Acceptance:** Strings wrap without relying on English word lengths. **Required verification:** Localization stress fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0242-08 - Measure comprehension.** **Acceptance:** Users understand what changed and what happens next. **Required verification:** Uncoached task study. **Implementation:** Not started; Needs a person: an uncoached task study of whether people understand what changed and what happens next; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and intentional Pause, unchanged local audio and LRCLIB metadata disclosure, current/draft revision guards and scoped Undo, stable song/seam identity, explicitly consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, accurate Library readiness, neutral blind studies and decodable exact frozen-revision FLAC. Include relevant offline/slow/stale/failed/cancel, duplicate song, RTL/long copy, 320–2560px/400% zoom, touch/keyboard/NVDA, forced color, reduced motion and real-audio testing.

## Dependencies, evidence and status

- **Depends on:** ADR-0138/0182/0159; new ADR-0198/0199 and corresponding programme checklist.
- **Next:** owner acceptance → design review → focused implementing PR with tests → independent audio, accessibility, visual and hardware acceptance → release decision.
- **Now:** Decision Accepted; Implementation 1/8 (2026-11-10); Independently Verified No; implementing branch feat/finish-checklists.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
