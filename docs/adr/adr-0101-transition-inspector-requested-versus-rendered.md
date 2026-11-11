# ADR-0101: Transition Inspector: requested intent, rendered reality, exact cues and safe previews

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 7/10 Implemented, 3 In progress (per-task source and test reconciliation 2026-11-10)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 5 Creator
- **Extends, does not automatically supersede:** ADR-0014, ADR-0058, ADR-0083
- **Source surfaces to reconcile:** `web/src/views/SeamInspector.tsx`; `web/src/views/Mix.tsx`; `web/src/audio/focus.ts`
- **Tasks:** S4-0101-01 through S4-0101-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

The inspector must explain the connection between two exact songs, its chosen move, rendering state, fallback and ultimately audible result. Selection state alone is not evidence that an audio version exists.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Organize a contextual inspector around Hear → Change → Refine → Understand. Preserve current tabs and every existing move/cue field while foregrounding the actual ready result and its revision identity.

## Experience, frontend and interaction specification

- Persistent pair header identifies outgoing/incoming song IDs, current/draft scope and seam revision.
- Show Requested move, Processing, Available render, Actual audible outcome as distinct concepts; never replace actual with wishful state.
- Move picker includes effect, selected/available/unavailable state and reason; advanced controls only when relevant.
- Inspector can be resizable desktop panel or mobile sheet; tab/preview/selection survives safe route movement.

## Detailed implementation work

1. **S4-0101-01 - Design Inspector overview with exact pair identity and readiness.** Acceptance: Opening any seam never appears to target another pair after reordering. Required verification: Selected seam removal and request join tests. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/mp-0288-seam-inspector.e2e.ts` 'a reorder or a late answer never switches the pair being inspected'; `web/e2e/finishing.e2e.ts` 'it stays clear which pair they're about', run 2026-11-10. Verified: No.**
2. **S4-0101-02 - Differentiate requested setting, working render and audible fallback.** Acceptance: User understands why actual rendered move differs. Required verification: Fallback, delayed render and failed render fixtures. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'keeps the move you asked for pressed, and names what really plays separately', 'says what you chose and what will really play, if they differ'; `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback', run 2026-11-10. Verified: No.**
3. **S4-0101-03 - Redesign move picker while retaining every available transition style.** Acceptance: All old options, disabled reasons and semantics remain operable. Required verification: Option parity and keyboard selection tests. **Implementation: In progress (2026-11-10). Evidence: move list from the server with disabled reasons (`tests/test_arrange.py::test_the_chooser_explains_when_it_can_not_be_chosen`; `web/src/views/Mix.test.tsx` 'says why the stems can't be shaped'); no option-parity test against the pre-4.0 list. Verified: No.**
4. **S4-0101-04 - Reorganize bar/cue/overlap controls by outgoing/incoming/handoff.** Acceptance: Every existing parameter persists exactly and is validated. Required verification: Boundary, missing cue and out-of-range tests. **Implementation: In progress (2026-11-10). Evidence: `web/e2e/mp-0288-seam-inspector.e2e.ts` 'a refused change shows its error under the fields'; boundary and missing-cue persistence not yet tested per field. Verified: No.**
5. **S4-0101-05 - Preserve per-seam rendering, retry and status feedback.** Acceptance: No claim of success until matching output key is available. Required verification: Backend delayed/error/old server tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'offers no render button while the seam is under way', 'does not present remembered failures as ongoing renders'; `web/src/player.test.ts` 'loads a completed render without waiting for the whole mix to refresh', run 2026-11-10. Verified: No.**
6. **S4-0101-06 - Define old/new preview identities and A/B only where actually supported.** Acceptance: No two labels point to one audio version falsely. Required verification: Preview key/snapshot and audio owner tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'plays the exact render' (`/api/seams/<key>/preview`); no A/B is offered, so none is claimed, run 2026-11-10. Verified: No.**
7. **S4-0101-07 - Harden concurrent setting changes and stale responses.** Acceptance: Older render result cannot overwrite newer intent. Required verification: Blend→Cut out-of-order response race. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'keeps the latest choice visible when an older server response refreshes the inspector'; `web/e2e/finishing.e2e.ts` 'two quick seam changes on a slow server: the last one wins', run 2026-11-10. Verified: No.**
8. **S4-0101-08 - Preserve rating/comment and detailed why information.** Acceptance: Feedback applies to actually heard transition version. Required verification: Rating after changed render and key mismatch. **Implementation: In progress (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'offers listening and rating once ready', 'has everything about it a tab away'; rating after a changed render key is not yet tested. Verified: No.**
9. **S4-0101-09 - Validate inspector tabs/sheet/focus and resize.** Acceptance: Keyboard, NVDA, touch and zoom remain usable. Required verification: Tabs/resize/close/focus-return tests. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/finishing.e2e.ts` transition tabs from the keyboard; `web/e2e/mp-0288-seam-inspector.e2e.ts` tab semantics and 320px sheet; `web/src/views/inspectorResize.test.tsx`, run 2026-11-10. Verified: No. Needs a person: NVDA, touch and zoom check.**
10. **S4-0101-10 - Record musical quality limitations distinctly from technical readiness.** Acceptance: Successful render not falsely scored good by algorithm. Required verification: Human auditory review on diverse transitions. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mix.test.tsx` 'has everything about it a tab away' asserts the inspector says it can't tell you how it sounds, run 2026-11-10. Verified: No. Needs a person: human auditory review on diverse transitions.**

## Required negative cases and regression strategy

- Transition pair changed while render pending; old audio cannot be labelled current.
- Preview starting during main playback must obey single-owner policy.
- Missing rendered audio, old-server fields and musical fallback reasons must be clear.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

More explicit version identity adds information but prevents severe trust failures in expert edits.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0101 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 7/10 Implemented, 3 In progress | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
