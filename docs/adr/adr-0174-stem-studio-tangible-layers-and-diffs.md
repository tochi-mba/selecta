# ADR-0174 - Stem Studio: tactile layers, accurate playhead and human–Selecta differences

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 6/7 Implemented, 0/7 In progress, 1/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0152, ADR-0122, ADR-0102; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/Studio.tsx; web/src/studio.ts; web/src/styles/creation.css; web/src/audio/focus.ts.

## Context and evidence boundary

Eight lanes of vocals, drums, bass and melody are already editable through Shape, Grid and List with local recovery and AI suggestions. The next design step is a cohesive visual material language and a faithful review of changes to a user-authored shape.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, older implementation checkmarks and this docs PR cannot demonstrate that a new CI task is implemented or independently verified.

## Accepted decision

- Give drums, bass, vocals and melody different non-colour patterns and clear labels in both song halves.
- Shape mode shows broad musical bands; Detailed Grid subdivides precisely the same 8–64 cell arrangement; List stays equivalent.
- Drive active-column indication solely from actual StemDeck preview time, never independent animation.
- Make cell paint immediate and visually clear while leaving an accessible single-cell action.
- Review Selecta's returned arrangement as exact added, removed and unchanged cells, preserving the original user shape for reversal.
- Differentiate working, recovered, applied and rendered; do not equate Apply with audio completion.

## Visual, animation and microinteraction contract

- Cell toggles respond in 0–100 ms, without bounce or latency.
- Mode morph is optional decoration and never changes stored shape, focus or underlying sound.
- Preview cursor and lane emphasis stop immediately when audio ownership changes.

## Alternatives and trade-offs

Preserve the current restrained design when a richer animation does not measurably improve comprehension, creative control or delight. Illustrative graphics are not analysed waveforms, beats, timed lyrics, fake quality ratings or album artwork. Every animated interaction needs an accessible static/keyboard equivalent; audio and current/draft correctness outrank motion.

## Implementation checklist - 6/7 Implemented, 0/7 Verified

1. **CI-0174-01 - Design eight-lane visual material system.** **Acceptance:** Four parts and both songs recognized through text/pattern, not only hue. **Required verification:** Color-blind, forced-colors and expert review. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "shows a square for every part of both songs, named for a screen reader" (vitest, passed 2026-11-10); colour-blind and expert review still needs a person.
2. **CI-0174-02 - Specify Shape Grid List equivalence.** **Acceptance:** No mode switch loses or coarsens cell values or focus. **Required verification:** 8–64-cell roundtrip property tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "switches between guided Shape and Detailed without changing the grid", "guided Shape edits the same exact lane shown by Detailed", "keeps every stem square and its saved value when changing editor modes" (vitest, passed 2026-11-10).
3. **CI-0174-03 - Refine painting and solo feedback.** **Acceptance:** Pointer strokes toggle once per cell; solo never changes saved arrangement. **Required verification:** Pointer, keyboard and audio tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "paints a consistent value over touched cells without re-toggling a revisited cell", "tapping twice puts it back", "pressing a name plays only that part, and can go back to everything" (vitest, passed 2026-11-10).
4. **CI-0174-04 - Drive true preview playhead.** **Acceptance:** Preview cursor follows deck and stops on Stop, error, hidden and close. **Required verification:** Real clock and audio owner tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "marks the square being played", "stops the owned Studio preview and its playhead when the tab becomes hidden", "closing lets go of the audio", "play and stop, and it pauses the mix when it plays" (vitest, passed 2026-11-10).
5. **CI-0174-05 - Show exact AI suggestion diffs.** **Acceptance:** Only returned changes highlighted and old shape recoverable. **Required verification:** Stale-tune, canceled generation and Undo fixtures. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "lists the exact server-returned cell differences and lets the user restore the previous shape", "lets Selecta arrange it, and what was there can be put back" (vitest, passed 2026-11-10).
6. **CI-0174-06 - Clarify recovery versus applied audio.** **Acceptance:** Unsaved/recovered/applying/rendered all visibly distinct. **Required verification:** Storage-quota, restart and render failure tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Studio.test.tsx "recovers a valid uncommitted grid for the same transition", "ignores a corrupted local grid and safely uses the server shape", "nothing it does is final until “Apply to this transition”", "if using it fails, the shape is still there to try again" (vitest, passed 2026-11-10).
7. **CI-0174-07 - Validate low-resource Studio precision.** **Acceptance:** Grid responsive and audible preview free of overlap during render load. **Required verification:** Named-device input/frame/audio measurements. **Implementation:** Needs a person: named-device input, frame and audio measurements during render load; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner and manual Pause, original files and LRCLIB disclosure, scoped mix/draft revisions and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing Library/routes, neutral blind A/B, decodable frozen-revision FLAC and local operation. Test errors, cancel, stale response, missing/RTL names, long set, offline, 320–2560px, zoom, forced colors, reduced motion, touch, keyboard and real audio where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0152, ADR-0122, ADR-0102; reconcile old task status against actual source before implementing.
- **Implementation sequence:** owner decision → visual/state prototype → fixtures → scoped source PR → independent AT/audio/device/human verification → release signoff.
- **Current:** Accepted; Not started; Independently Verified No. There is no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
