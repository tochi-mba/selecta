# ADR-0228 - My Mixes: collectible sleeves, explicit current performance and render line

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / My Mixes.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0149/0179/0119; earlier statuses unchanged.
- **Existing source touchpoints:** web/src/views/MyMixes.tsx; web/src/views/Drafts.tsx; web/src/views/CurrentMix.tsx.

## Context and evidence boundary

Turn saved mixes into tangible creative artifacts while keeping current playback, editable draft projects and render jobs distinct. Activate/rename/delete semantics remain revision-safe. Existing functional code can be reused; this record defines additional visual, interaction and human-outcome acceptance and does not certify its implementation or independent verification.

## Proposed decision

Turn saved mixes into tangible creative artifacts while keeping current playback, editable draft projects and render jobs distinct. Activate/rename/delete semantics remain revision-safe. Favor accessible, truthful, music-first expression. Retain current route functionality and backend truth while enhancing layout, copy, hierarchy and feedback. If a redesign obscures correct status or adds risk, prefer the simpler proven interaction.

## Visual, animation and microinteraction contract

- Clear primary musical object, one intentional primary action and discoverable advanced capability.
- Planned versus prepared versus committed versus playing status and exact object scope must be visible.
- Motion follows cause, actual user action or measured music rather than decorative pseudo-beats and preserves static equivalents.
- Keep interaction available by pointer, touch, keyboard, screen reader, reduced motion, forced colors and high zoom.

## Alternatives, trade-offs and limits

No treating the render queue as the song queue, invisible draft activation or data loss on rename/delete. Do not add accounts, SaaS subscriptions, cloud uploads, telemetry, hardware launchers or new audio sources through this design proposal.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0228-01 - Design current mix hero.** **Acceptance:** Active mix and listening state obvious. **Required verification:** Current/draft comprehension. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0228-02 - Build draft sleeve gallery.** **Acceptance:** Draft and ready mix statuses correct. **Required verification:** Mixed-state fixture. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0228-03 - Explain edit versus play.** **Acceptance:** Clear project actions by scope. **Required verification:** Novice task test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0228-04 - Protect draft activation.** **Acceptance:** Explicit replacement or change consent if required. **Required verification:** Revision/audio E2E. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0228-05 - Refine naming and deletion.** **Acceptance:** Undo/confirmation applied only where real. **Required verification:** Failure and conflict tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0228-06 - Separate render line visually.** **Acceptance:** Background job queue not confused with playback Up Next. **Required verification:** Comprehension study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0228-07 - Maintain deep links.** **Acceptance:** Draft IDs and current mix remain stable after navigation. **Required verification:** Route test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0228-08 - Verify collection lifecycle.** **Acceptance:** Create, save, edit, export and return coherent. **Required verification:** End-to-end journey. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve original local music; intentional Pause and one audio owner; disclosed LRCLIB metadata lookup; exact current/draft revisions and Undo; stable song and seam IDs; atomic bridge joining with explicit consent; eight-lane Studio and local recovery; honest readiness and processing; neutral blind comparison; frozen-revision decodable FLAC. Exercise failures, stale results, missing music, offline and multitab, 320px/high zoom, long/RTL names, keyboard/touch/AT, forced colors, reduced motion and real audio when applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0149/0179/0119; ADR-0198/0199 and cross-cutting UI foundation.
- **Next:** owner decision → prototypes → source-level implementation PR → regression tests → independent visual, access, audio and device evidence → release gate.
- **Now:** Accepted; 0/8 Implemented; 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
