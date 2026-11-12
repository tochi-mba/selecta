# ADR-0102: Stem Studio eight-lane arrangement, accessible time grid and recovery-safe Apply

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (10/10 implemented, 0 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 6 Expert
- **Extends, does not automatically supersede:** ADR-0016, ADR-0059, ADR-0084
- **Source surfaces to reconcile:** `web/src/views/Studio.tsx`; `web/src/styles/creation.css`; `web/src/audio/focus.ts`
- **Tasks:** S4-0102-01 through S4-0102-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Studio combines an eight-lane, variable-length stem grid, preview transport, AI assistance, recovery and apply/render stages. A visual rewrite could easily erase working intent or make expert controls mouse-only.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Recompose Studio as a compact musical workstation with persistent pair context, usable time ruler, sticky lane identities, two-track separation, consistent audition controls and explicit Working/Applied/Rendered semantics.

## Experience, frontend and interaction specification

- Group Voice, Drums, Bass, Melody under outgoing and incoming songs; do not invent new stem colours that overwhelm brand.
- 64-cell and smaller grids use horizontal overflow or overview, not tiny touch targets.
- Working copy may be local-only; applying requires exact current seam and revision validation.
- AI-assisted arrangement may suggest changes but a late response cannot override newer human edits.

## Detailed implementation work

1. **S4-0102-01 - Redesign Studio pair header, ruler and eight-lane grid hierarchy.** Acceptance: Track/stem/time identities are always understandable. Required verification: 8/16/32/64-cell screenshot and screen reader tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/Studio.tsx pair header (song motifs, 'Shape transition N'), Bar ruler row and two song rowgroups of four lanes; web/src/views/Studio.test.tsx 'shows a square for every part of both songs, named for a screen reader', 'shows which numbered pair is being shaped'. Needs a person: 8/16/32/64-cell screenshot review and an NVDA/Edge pass of the grid.
2. **S4-0102-02 - Preserve mouse, touch, Space, arrow, Home/End and Ctrl+Home/End grid actions.** Acceptance: All grid operations act on correct cell with visible focus. Required verification: ARIA grid keyboard and touch-scroll suite. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Studio.tsx gridKeys (arrows, Home/End, Ctrl+Home/End, one tab stop) and pointer painting; Studio.test.tsx 'is one tab stop, moves with the arrow keys, and Space turns a square on or off', 'Studio pointer painting'; web/e2e/finishing.e2e.ts 'the full Studio grid works at the smallest size'. Needs a person: touch-scroll on a real phone.
3. **S4-0102-03 - Make labels and time orientation sticky where appropriate.** Acceptance: Horizontal scroll never hides which stem or song is edited. Required verification: Narrow viewport, zoom, scroll tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/styles/creation.css sticky .studio-ruler, .studio-name and .studio-side-name, polish.css sticky .studio-name; finishing.e2e.ts 'the full Studio grid works at the smallest size: it scrolls by itself'. Needs a person: 200%/400% zoom visual review.
4. **S4-0102-04 - Preserve solo/mute and missing-stem disabling truthfully.** Acceptance: Missing media cannot be toggled as if auditionable. Required verification: Partial/missing/corrupt stem fixtures. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/studio.ts StemDeck.load reports missing stems; Studio.tsx aria-disabled lanes and a naming alert; new web/src/views/StudioSafety.test.tsx 'a stem that could not load is named, disabled and cannot be toggled or soloed'. Needs a person: corrupt-stem check on real media.
5. **S4-0102-05 - Unify preview transport and audio-focus lifecycle.** Acceptance: Closing, failing, switching preview cannot overlap main mix. Required verification: Studio→Inspector→Listen audio-owner races. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Studio.tsx takeAudio/releaseAudio owner and hidden-tab stop; Studio.test.tsx 'play and stop, and it pauses the mix when it plays', 'closing lets go of the audio', 'stops the owned Studio preview and its playhead when the tab becomes hidden'; web/src/audio/focus.test.tsx 'one sound at a time'. Needs a person: audible Studio to Inspector to Listen handoff on real audio.
6. **S4-0102-06 - Clarify dirty, recovered, applied and rendered states.** Acceptance: User knows if work has reached the mix or audio file. Required verification: Apply pending/complete/failure screenshot + data assertions. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Studio.tsx 'Where this shape has got to' list (working copy, recovered, applied, rendered) and save-state status; StudioSafety.test.tsx 'says plainly when the working copy differs from what is applied and rendered'; Studio.test.tsx 'using it saves the shape, closes and says what happens next'. Needs a person: screenshot review of Apply pending, complete and failed.
7. **S4-0102-07 - Preserve validated local working-copy recovery.** Acceptance: Malformed, wrong cell count or wrong pair data not misapplied. Required verification: Storage blocked, invalid JSON, 64-to-8 migration tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Studio.tsx savedShape validation and keepShape; Studio.test.tsx 'ignores a corrupted local grid and safely uses the server shape', 'recovers a valid uncommitted grid for the same transition'; StudioSafety.test.tsx 'never recovers a working copy with a different cell count', 'never recovers non-binary values or a working copy that is not JSON', 'warns instead of promising recovery when this browser cannot store the working copy'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read StudioSafety.test.tsx and Studio.test.tsx recovery cases (corrupt JSON, wrong cell count, non-binary values, blocked storage) against Studio.tsx savedShape and keepShape; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
8. **S4-0102-08 - Preserve human/AI arrangements and undo Put it back.** Acceptance: Late generated suggestions cannot erase more recent manual edit. Required verification: AI response ordering, rapid toggles and retry. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Studio.tsx askSelecta tuneAttempt/latestShape guard and Put it back; Studio.test.tsx 'lets Selecta arrange it, and what was there can be put back', 'a change of your own clears what fine tuning said'; StudioSafety.test.tsx 'a suggestion that arrives after a manual edit never replaces the newer edit'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read the late-suggestion guard (tuneAttempt and latestShape in Studio.tsx) and its test, which resolves a held tune answer after a manual click and checks the click survives; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
9. **S4-0102-09 - Harden Apply against stale pair, draft and revision.** Acceptance: Failed Apply retains local work and does not modify other draft. Required verification: Concurrent reorder, draft switch and server timeout tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Studio.tsx use() re-checks the pair key and sends the mix guard; Studio.test.tsx 'a mix that moved on refuses the shape, and it stays here to try again', 'if using it fails, the shape is still there to try again'; StudioSafety.test.tsx 'a failed Apply keeps the working copy in place and in this browser', 'an Apply into a pair that changed sends nothing and keeps the working copy'; tests/test_studio.py. Needs a person: two-tab draft switch against a real server.
10. **S4-0102-10 - Explore alternate accessible nonspatial lane editor without capability loss.** Acceptance: All toggles could be operated via conventional controls if adopted. Required verification: Human NVDA tasks before acceptance. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12).** Evidence: Studio.tsx StudioListEditor (fieldsets and checkboxes) and StudioShapeEditor over the same data; Studio.test.tsx 'Studio representation parity', 'switches between guided Shape and Detailed without changing the grid'. **Verified:** Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12): switching to Detailed list, NVDA said 'Detailed list controls. All eight lanes and every square are unchanged', then 'Morning Light region, Voice grouping, bars 1-2 check box checked'; Tab moved square by square and Space said 'not checked' with 'Unsaved changes - not applied to the mix', so every toggle works as a plain checkbox with no spatial reading (NVDA 2026.3.1 with headed Edge 157 on Windows 11 at 1280x860, made-up library with SELECTA_E2E_STRESS=1, commit 9af0eb13 plus working tree, speech log docs/verification/claude-checks/selecta-4-implementation-checklist/nvda/nvda-2026.3.1-session-1.txt).

## Required negative cases and regression strategy

- Studio closed after dirty change and local storage denied: no false recovery guarantee.
- Grid changed by other tab while Apply pending.
- An alternative grid view must share exact same data, not a reduced expert feature subset.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Horizontal scrolling is preferable to shrinking 64 columns into illegible controls.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0102 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | Implemented (10/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
