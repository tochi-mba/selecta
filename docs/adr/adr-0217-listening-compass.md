# ADR-0217 - Listening Compass and scoped, supported musical shaping

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 needing a person; updated 2026-11-11).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0143/0169/0117; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/MixSetup.tsx; web/src/views/Mixes.tsx.

## Context and evidence boundary

Create an optional expressive intent interface strictly mapped to supported planner values, with exact controls and per-mix/default scope distinction. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Create an optional expressive intent interface strictly mapped to supported planner values, with exact controls and per-mix/default scope distinction. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

No unsupported mood promises, implicit global preference change or uncommitted draft mutation. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0217-01 - Audit planner capabilities.** **Acceptance:** Every choice has actual backend mapping. **Required verification:** Capability contract audit. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** capability audit: feel, stem moves, energy arc and destination each persist through `/api/steer`: `tests/test_product.py::test_steering_persists`, `::test_the_api_saves_and_clears_the_custom_energy_arc`, `::test_mixing_language_keeps_choices_without_forcing_one_recipe`, `tests/test_mix_mixes.py::test_destination_steering_persists_and_status_names_the_song`, `::test_stem_frequency_steering_persists_and_validates` (2026-11-10).
2. **SF-0217-02 - Prototype Compass vocabulary.** **Acceptance:** Non-experts comprehend musical direction. **Required verification:** Novice study. **Implementation:** Needs a person: novice comprehension study of Compass vocabulary; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0217-03 - Keep exact energy inputs.** **Acceptance:** Five-stop values lossless and accessible. **Required verification:** Keyboard value tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/MixSetup.test.tsx` 'keeps numeric input, slider and drawn stops on the same exact preference values' (native range and spinbutton inputs) (2026-11-10).
4. **SF-0217-04 - Clarify scope.** **Acceptance:** Default and this-mix choices remain separate. **Required verification:** Refresh/draft E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r3j; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/e2e/sf-flow-create.e2e.ts` 'SF-0217-04 the next-mix default and this mix’s own choices stay apart through a reload'; `web/src/views/Mixes.test.tsx` 'how mixes get built ... says it's for new mixes'; run 2026-11-11 (dist-r3j).
5. **SF-0217-05 - Explain feasibility limits.** **Acceptance:** No-match and destination limits honest. **Required verification:** Fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r2k; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/sfFlowCompass.test.tsx` 'says plainly when no ready song matches, rather than offering songs that can’t be mixed', 'says a destination is something mixes try for, and that they finish as near as they can', 'a failed search is a failure with a retry, never an empty “no match”' (3 passed); `tests/test_mix_mixes.py::test_destination_steering_persists_and_status_names_the_song` (2026-11-10).
6. **SF-0217-06 - Keep direct Play path.** **Acceptance:** Compass remains optional. **Required verification:** Findability task. **Implementation:** Needs a person: findability task confirming the Compass stays optional; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0217-07 - Preserve cancellation.** **Acceptance:** Unapplied choices cannot alter active mix. **Required verification:** Cancel/Undo tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/MixSetup.test.tsx` 'cancels an interrupted pointer stroke without leaving a half-drawn energy choice'; `web/src/views/Mixes.test.tsx` 'keeps the active mix until confirmation', 'does not claim an energy shape was saved when clearing the shape fails' (2026-11-10).
8. **SF-0217-08 - Test creative agency.** **Acceptance:** Users can predict outcome and scope. **Required verification:** DJ/listener sessions. **Implementation:** Needs a person: DJ/listener sessions on predicted outcome and scope; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0143/0169/0117, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Accepted; 5/8 Implemented (2026-11-11); 0/8 independently Verified; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
