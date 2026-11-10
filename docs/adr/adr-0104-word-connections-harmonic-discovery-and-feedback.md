# ADR-0104: Lyric-word connections, harmonic four-stage auditions and version-bound feedback

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (9/10 implemented, 1 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 7 Discovery
- **Extends, does not automatically supersede:** ADR-0019, ADR-0061, ADR-0085
- **Source surfaces to reconcile:** `web/src/views/Links.tsx`; `web/src/views/Listening.tsx`; `src/selecta/routes/discover.py`
- **Tasks:** S4-0104-01 through S4-0104-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Word/lyric connections and harmonic matching are distinctive music discovery experiences that can become technical data cards without expressing why a pair is worth hearing.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Present the musical relationship first-shared lyric phrase or harmonic comparison-then preview and technical detail. Preserve transition rendering, rating, pair insertion and the exact four-stage harmonic audition protocol.

## Experience, frontend and interaction specification

- Word cards prioritize the shared word/phrase, each lyric context, song identity and preview readiness.
- Weak or unavailable connections remain inspectable without appearing equally good.
- Harmonic stage order is detected chords → song A → song B → both together, with replay/stop and stage identity.
- Verdicts teach discovery models but do not automatically add songs to a mix.

## Detailed implementation work

1. **S4-0104-01 - Redesign word-connection result card hierarchy.** Acceptance: Shared phrase and exact two tracks precede technical controls. Required verification: Multiple/zero/weak matches snapshots. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/Links.tsx LinkCard puts the phrase and both songs before the move controls; Links.test.tsx 'shows the whole phrase in its own direction', 'says there's nothing yet when there is nothing to show'. Needs a person: multiple/zero/weak snapshot review.
2. **S4-0104-02 - Preserve pair previews and actual rendered transition context.** Acceptance: Preview-ready is different from render requested. Required verification: Slow/failed/mismatched render tests. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.tsx seamFacts keeps asked and heard apart ('You asked for X. What you'd hear is Y.'); new web/src/views/LinksRating.test.tsx shows a new render reads as Rendering; no dedicated slow/failed/mismatched word-render test yet. Needs a person: review once the render fixtures exist.
3. **S4-0104-03 - Preserve word-pair add-to-mix/draft and placement.** Acceptance: Both tracks and transition join according to existing atomic contract. Required verification: Pair insertion, duplicate ID, wrong-scope tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'goes in as one thing, so half of it can't be left behind', 'can go in a draft instead, and leaves what's playing alone'. Needs a person: independent review.
4. **S4-0104-04 - Preserve move change, Good/Bad rating and feedback key.** Acceptance: Rating applies only to corresponding audible version. Required verification: Change move during rating race. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.tsx rate() posts to the heard key and ignores a stale answer; new LinksRating.test.tsx 'sends the rating for the heard key, and the late answer does not replace the new move'. Needs a person: independent review.
5. **S4-0104-05 - Rebuild harmonic stage progress and audition controls.** Acceptance: Four stages remain in order, with replay and safe Stop. Required verification: Audition stage timing and individual replay tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'plays what it detected in one press: the chords, each song, then both', 'lets you jump to any step', 'stopping really stops'; tests/test_hearing.py 'an_audition_has_every_step_in_time_with_the_first_song'. Needs a person: audible stage timing check.
6. **S4-0104-06 - Use text/time indicators beyond colour-only chord strip.** Acceptance: Current stage/chord information discernible at zoom and via AT. Required verification: Contrast, NVDA and keyboard tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'shows the chords it read and lights the one being played'; test_hearing.py 'an_audition_says_which_chord_is_on_which_bar'. Needs a person: contrast and NVDA review.
7. **S4-0104-07 - Preserve Yes/No/Skip semantics and record saves.** Acceptance: No double submission or wrong pair rating. Required verification: Rapid skip/rate/reload/error tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'answering moves straight on', 'skipping puts a pair at the back without answering it', 'keeps focus on the answer while it saves', 'keeps answers out of the way, and they can be changed'. Needs a person: independent review.
8. **S4-0104-08 - Handle missing or failed audio with truthful recovery.** Acceptance: Cannot claim audio heard when clip unavailable. Required verification: Missing clip, delayed preparation tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'says so when a pair cannot be played, and you can still answer', 'never plays an obsolete prepared audition after the user skips that pair'. Needs a person: independent review.
9. **S4-0104-09 - Keep main playback isolated during audition.** Acceptance: No simultaneous owner or surprise resumption. Required verification: Preview ownership switching with Listen/Studio. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.test.tsx 'pauses the mix when it starts playing', 'stopping really stops, and answering afterwards does not start it again'; focus.test.tsx. Needs a person: audible owner switching with Listen and Studio.
10. **S4-0104-10 - Document learning-versus-playlist outcomes in labels.** Acceptance: Users understand feedback does not automatically alter mix. Required verification: Unassisted task question and content review. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Links.tsx copy 'Your answer only teaches Selecta what you hear. It never adds anything to a mix.'. Needs a person: unassisted comprehension question.

## Required negative cases and regression strategy

- Late clip prepared for old pair after user skips.
- Weak connections should remain discoverable, not silently filtered out if existing behaviour exposes them.
- Lyric matching with punctuation, multilingual text and empty metadata.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Clearer explanation increases card height; progressive detail should preserve scannability.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0104 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (9/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
