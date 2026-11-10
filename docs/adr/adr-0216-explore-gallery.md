# ADR-0216 - Editorial Explore gallery and genuine mix reveal

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0142/0168/0118; prior statuses unchanged.
- **Existing source touchpoints:** web/src/views/Mixes.tsx; web/src/views/MixSetup.tsx.

## Context and evidence boundary

Make musical ideas inviting while keeping eligibility, Play, Shape and Save choices accurate and safe. These are new design acceptance criteria, not proof that similar functionality does not already exist. Source-level implementation, automated tests, independent human review and musical acceptance remain distinct.

## Proposed decision

Make musical ideas inviting while keeping eligibility, Play, Shape and Save choices accurate and safe. Preserve a reliable, local-first instrument underneath any new art direction. Keep current versus draft context, exact song/seam IDs, authoritative analysis, single player ownership and transparent pending operations.

## Visual, animation and microinteraction contract

- Music leads; one obvious primary object/action with discoverable precision controls.
- Distinguish decorative visuals, requested intentions, measured states, render-complete artifacts and actual playback.
- Causal, optional, interruptible motion with reduced-motion and textual equivalents; never delay Pause, cancel or Undo.
- Every state has keyboard, touch, focus, high-contrast and screen-reader affordances where meaningful.

## Alternatives and trade-offs

No autoplay previews, fake computed results, invented classification or silent current-mix replacement. Reject spectacle when it costs accessibility, audio continuity or task comprehension. This ADR approves no new SaaS, login, account, cloud upload, telemetry, audio engine rewrite or code change by itself.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0216-01 - Design featured mix idea.** **Acceptance:** Clear intention and primary action. **Required verification:** Five-second glance. **Implementation:** Needs a person: five-second glance study of the featured idea; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0216-02 - Curate categories.** **Acceptance:** Counts and family filters match data. **Required verification:** Fixture tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mixes.test.tsx` 'groups mixes by why you'd press them', 'says what's inside each one, from the songs that would really play', 'shows and filters truthful family-specific candidates' (2026-11-10).
3. **SF-0216-03 - Generate grounded art.** **Acceptance:** Decorative art never claims analyzed traits. **Required verification:** Provenance audit. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'gives idea groups distinct, stable abstract motifs without pretending to show album art'; `web/src/views/Mixes.test.tsx` 'uses different decorative motifs for different ideas' (motifs aria-hidden, encode only the key) (2026-11-10).
4. **SF-0216-04 - Clarify Play Shape Save.** **Acceptance:** Distinct outcomes and accessible actions. **Required verification:** Task study. **Implementation:** Needs a person: task study of Play, Shape and Save outcomes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0216-05 - Show mix eligibility.** **Acceptance:** Not enough ready songs explained. **Required verification:** Backend fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mixes.test.tsx` 'says why a preset can't be played yet', 'waits for six mix-ready songs', 'keeps Christmas off the waiting list until there are enough songs'; `tests/test_product.py::test_status_distinguishes_analysed_songs_from_mix_ready_and_refreshes_after_lyrics` (2026-11-10).
6. **SF-0216-06 - Reveal confirmed plan.** **Acceptance:** Only server result appears as real mix. **Required verification:** Slow/failure E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mixes.test.tsx` 'keeps the active mix until confirmation and guards the mix seen when Play was chosen'; `web/e2e/flows.e2e.ts` 'a slow answer still gets an instant reaction on Start'; `tests/test_api_contracts.py::test_slow_build_never_replaces_a_mix_changed_during_planning` (2026-11-10).
7. **SF-0216-07 - Protect current playback.** **Acceptance:** Replacement consent maintained. **Required verification:** Audio/draft test. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Mixes.test.tsx` 'builds it without touching what's playing'; `web/src/views/Library.test.tsx` 'cancels active playback replacement without building'; `web/e2e/integration.e2e.ts` 'editing a draft while the current mix plays' (2026-11-10).
8. **SF-0216-08 - Evaluate inspiration.** **Acceptance:** Emotional quality improves without errors. **Required verification:** Comparative user study. **Implementation:** Needs a person: comparative user study of inspiration; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Preserve one audio owner and intentional Pause, original local music and LRCLIB metadata disclosure, revision-guarded current and draft and scoped Undo, consented atomic request bridges, eight-lane/8–64-cell Studio with recovery, truthful Library states, neutral blind evaluation and frozen-revision decodable FLAC. Test absent, stale, offline, failed and slow data, duplicate/RTL titles, 320px to wide, 400% zoom, forced colors, reduced motion and actual playback as applicable.

## Dependencies, evidence and status

- **Depends on:** ADR-0142/0168/0118, ADR-0198 and ADR-0199. Reconcile previous code per task rather than reimplementing blindly.
- **Sequence:** owner decision → design specimens → scoped code/test PR → independent audio/visual/AT/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation In progress (5/8, 2026-11-10); Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
