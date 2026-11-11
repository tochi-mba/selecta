# ADR-0059: Full Stem Studio workstation, grid interaction and commit safety

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 9 tasks implemented with automated evidence on 2026-11-11; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 - Creation workspaces
- **Extends existing decisions:** ADR-0016, ADR-0007, ADR-0041
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Stem Studio offers a 2-song/4-stem grid with 64 binary cells, immediate audition, solo, preset shapes, automatic arrange, fine-tune, restore previous and Apply render. Shrinking an entire grid into a dialog risks overflow, keyboard confusion, losing unfinished work or accidentally changing the wrong seam.

## Decision proposed

Make Studio a responsive focused workspace with permanent pair identity, aligned bar ruler, audition transport, two-song stem lanes and explicit working/recovered/committed/rendered states. Preserve all 64 cell controls, preset behavior, audio ownership and revision-bound commit.

## Experience and frontend architecture

- Separate real-time working shape from applied backend arrangement and ready rendered audio. Keep the bar ruler aligned during horizontal scrolling and lane labels visible. Mobile offers horizontal grid scrolling and deliberate controls without inventing unsupported per-beat audio precision.

- Use the WAI-ARIA grid pattern with a single tab stop, deterministic arrows/Home/End/Space, clear active/focus/solo feedback and accessible cell labels. Presets and automation preserve recoverable prior work; failed AI operations do not overwrite manual edits.

- Opening Studio auditions pauses the main mix through existing audio ownership. Closing/route changes respect user-intent flags; no preview may auto-resume playback after the user explicitly paused it.

## Detailed implementation work

1. **S3-0059-01 - Implemented.** Build dedicated Studio workspace with persistent pair header and responsive transport. **Evidence:** web/src/views/Studio.tsx; web/src/views/Studio.test.tsx 'shows which numbered pair is being shaped' and 'play and stop, and it pauses the mix when it plays'; web/e2e/finishing.e2e.ts 'the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it' (passed 2026-11-10).
2. **S3-0059-02 - Implemented.** Redesign 64 cells, two songs, four stem lanes, selected/active/inactive/solo states and aligned bar labels. **Evidence:** web/src/views/Studio.test.tsx 'shows a square for every part of both songs, named for a screen reader', 'marks the square being played' and 'pressing a name plays only that part, and can go back to everything' (passed 2026-11-10).
3. **S3-0059-03 - Implemented.** Implement accessible grid keyboard model, focus restoration and horizontal-scroll behavior. **Evidence:** web/src/views/Studio.test.tsx 'is one tab stop, moves with the arrow keys, and Space turns a square on or off'; web/e2e/finishing.e2e.ts 'the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it' (passed 2026-11-10).
4. **S3-0059-04 - Implemented.** Keep stem preview, solo, preset shapes, auto-arrange, Fine tune mine and Restore previous operations. **Evidence:** web/src/views/Studio.test.tsx 'tapping a square is heard straight away and renders nothing', 'pressing a name plays only that part, and can go back to everything', 'ready-made shapes change the grid, and it can start again', 'lets Selecta arrange it, and what was there can be put back', 'fine tunes your own grid and says what it changed and why' and 'lists the exact server-returned cell differences and lets the user restore the previous shape' (passed 2026-11-10).
5. **S3-0059-05 - Implemented.** Separate dirty local shape, recovered local draft, backend committed shape and rendered audio status. **Evidence:** web/src/views/Studio.test.tsx 'ignores a corrupted local grid and safely uses the server shape', 'recovers a valid uncommitted grid for the same transition', 'starts from the shape already chosen when coming back to a seam' and 'nothing it does is final until “Apply to this transition”' (passed 2026-11-10).
6. **S3-0059-06 - Implemented.** Make Apply revision-checked and never attach a saved shape to an old or different pair. **Evidence:** web/src/views/Studio.test.tsx 'a mix that moved on refuses the shape, and it stays here to try again'; tests/test_studio.py test_a_different_shape_is_a_different_seam and test_a_saved_shape_comes_back_in_the_request (passed 2026-11-10).
7. **S3-0059-07 - Implemented.** Handle partial stem availability, loading/error, preview failure and close during processing. **Evidence:** web/src/views/Studio.test.tsx 'marks that lane unavailable, ignores presses on it, and leaves the other lanes working', 'says how long the stems will take while they are split, and that the mix keeps playing', 'if using it fails, the shape is still there to try again', 'explains when Selecta can’t arrange these two, and keeps the grid as it is' and 'closing lets go of the audio' (passed 2026-11-10).
8. **S3-0059-08 - Implemented.** Profile interaction responsiveness during background render and suppress excessive grid remounts. **Evidence:** web/e2e/s3-profiles.e2e.ts 'S3-0059-08 the Studio grid answers within budget during a background render and never remounts its cells' (prints an S3-PROFILE line) (passed 2026-11-11).
9. **S3-0059-09 - Needs a person.** Exercise all cell positions, solo combinations, and playback interruptions with real audio evidence. **Status:** Needs a person: real-audio evidence for every cell position, solo combination and playback interruption; the automated cell and solo behaviour passes in web/src/views/Studio.test.tsx.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Matrix of all 64 cells and each lane state, arrows/Space/End, screen reader names and 200/400% zoom.
- Toggle, solo, navigate away, user pauses main, reopen/recover, commit after reordered pair; reject stale revision.
- AI arrange fails after local edits, browser storage unavailable, missing stems and partial load; original shape survives.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A full new audio arrangement engine or arbitrary DAW timeline would exceed UI scope. The existing binary-cell model remains canonical; improve its representation and interaction contract.

## Acceptance and evidence

An expert can edit, hear, recover and commit stems on the intended pair using pointer, touch and keyboard with no audio overlap or data loss.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (7/9) | Task-by-task evidence on each item; 1 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
