# ADR-0179 - My Mixes: current-performance identity, drafts and real render line

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P1 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0149, ADR-0119, ADR-0099; earlier status unchanged.
- **Existing source touchpoints:** web/src/views/MyMixes.tsx; web/src/views/Drafts.tsx; web/src/views/CurrentMix.tsx.

## Context and evidence boundary

The current-versus-draft model and render line are technically sound but visually modest. Stable mix identities, actual energy thumbnails and a truthful render queue can give each creative work presence while keeping independent drafts safe.

This ADR proposes a **new cross-surface design and acceptance delta**, not a claim that existing code/accepted MI decisions are missing. No independent human, visual, audio, device or implementation verification has occurred for these new tasks.

## Accepted decision

- Give the active current mix a more prominent performance identity while drafts remain visually calm.
- Represent each draft's real song energy and seam readiness at small scale; show a neutral fallback for missing data.
- Make Edit, Play, Copy, Rename, Delete and Prioritize clearly distinct outcomes.
- Treat rendering as an ordered background preparation queue, not playback.
- Make switching a draft into current a confirmed, reversible state transition with explicit warnings.
- Keep an empty or stale draft state inspiring and recoverable without hiding operational truth.

## Visual, animation and microinteraction contract

- A draft becomes current only after server confirmation; the old mix is not visually lost early.
- Reorder animation follows actual queue order with keyboard alternative.
- No dancing playing indicator for paused, idle or merely queued draft.

## Alternatives and trade-offs

Prefer the existing restrained and proven UI when added visuals distract or reduce correctness. No artificial music, artwork, beat, lyric accuracy, quality score or fake render status. All sensory interactions require a usable static, keyboard, high-contrast and reduced-motion alternative. Source truth and explicit human consent outrank polish.

## Implementation checklist - 0/7 Implemented, 0/7 Verified

1. **CI-0179-01 - Distinguish current mix and saved draft.** **Acceptance:** Current/draft scope always legible and labelled in all densities. **Required verification:** Side-by-side dark/light and screen reader review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **CI-0179-02 - Design truthful energy thumbnail.** **Acceptance:** Real relative values and unknown fallback only. **Required verification:** Missing and nonnumeric energy fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **CI-0179-03 - Clarify draft action outcomes.** **Acceptance:** Play/Edit/Delete/Prioritize cannot be mistaken for each other. **Required verification:** Current-playing and paused confirmation tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **CI-0179-04 - Visualize segmented transition readiness.** **Acceptance:** Ready/queued/failure shown per seam, no invented total percent. **Required verification:** Render status and ETA fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **CI-0179-05 - Show actual render-line priority.** **Acceptance:** Displayed reorder corresponds to server order under collisions. **Required verification:** Queue reorder/concurrency tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0179-06 - Preserve missing and empty draft recovery.** **Acceptance:** Cannot silently edit deleted draft or lose current mix. **Required verification:** Stale route and Undo tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **CI-0179-07 - Measure multi-draft retrieval.** **Acceptance:** Users can find intended project and know readiness quickly. **Required verification:** Timed multi-draft task and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve the single audio owner, manual Pause, original files, LRCLIB metadata disclosure, mix/draft revision guards and Undo, real seam status and exact pair, explicit atomic bridge consent, eight Studio lanes with full recovery, Library/routes, neutral blind listening study and decodable frozen-revision FLAC. Review empty/long/RTL data, error, offline, cancellation, stale responses, 320–2560px, 400% zoom, touch, screen reader, forced colors and audio under render load.

## Dependencies, evidence and status

- **Depends on:** ADR-0149, ADR-0119, ADR-0099; reconcile old tasks before implementing.
- **Sequence:** owner acceptance → design prototype/state specs → scoped PR and tests → independent human/audio/AT/performance evidence → signed release gate.
- **Current:** Accepted; Not started; Independently Verified No, owner unassigned, no implementation PR.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
