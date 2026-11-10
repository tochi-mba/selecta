# ADR-0061: Word connections and four-stage harmonic discovery

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0019, ADR-0042
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Word connections match shared lyric phrases with transition previews, ratings and pair insertion. Harmonic discovery uses ordered four-stage auditions and Yes/No/Skip judgments. Their task semantics differ from preset mix browsing and should not be accidentally merged.

## Decision proposed

Place Word Connections and Harmonic Matches under Explore, with their own focused subroutes and honest preview states. Preserve pair atomicity and distinguish a harmonic judgment from adding tracks to an active/draft mix.

## Experience and frontend architecture

- Word cards center the shared phrase and source context, show true render readiness, permit style selection and preview, and maintain selected current/draft insertion target. Pair addition is a single consistent transaction.

- Harmonic listening preserves stages: source chords, first track, transformed second track and combined result. Labels identify what is currently audible; Yes/No/Skip and recovery remain independent of downstream mix insertion.

- A result's musical-fit rating is separate from renderer failures. The UI must never claim a successful connection solely because detection produced a candidate.

## Detailed implementation work

1. **S3-0061-01 - Implemented.** Rebuild Word Connections browse hierarchy around readable shared lyric phrase and two source tracks. **Evidence:** web/src/views/Links.tsx phrase heading with both songs and lines; web/src/views/Links.test.tsx 'shows the whole phrase in its own direction, and a search shows only what matches' and 'says there’s nothing yet when there is nothing to show' (passed 2026-11-10).
2. **S3-0061-02 - Implemented.** Preserve available transition moves, preparation, preview, fallback and exact audio-version status. **Evidence:** web/src/views/Links.test.tsx 'goes in as one thing, so half of it can’t be left behind'; tests/test_wordplay.py (whole file, synthetic audio for each word move) (passed 2026-11-10).
3. **S3-0061-03 - Implemented.** Design clear approve/rate/add-pair actions with current/draft target and atomic insertion. **Evidence:** web/src/views/Links.test.tsx 'goes in as one thing, so half of it can’t be left behind' and 'can go in a draft instead, and leaves what’s playing alone' (passed 2026-11-10).
4. **S3-0061-04 - Implemented.** Retain failed or poor connection access with accurate reasons, not fabricated quality judgments. **Evidence:** web/src/views/Links.test.tsx 'says so when a pair cannot be played, and you can still answer' and 'can’t load isn’t the same as nothing there' (passed 2026-11-10).
5. **S3-0061-05 - Implemented.** Rebuild harmonic four-stage audition flow with obvious current stage and playback state. **Evidence:** web/src/views/Links.test.tsx 'plays what it detected in one press: the chords, each song, then both', 'shows the chords it read and lights the one being played', 'lets you jump to any step' and 'never calls a requested harmonic stage playing until the media element starts' (passed 2026-11-10).
6. **S3-0061-06 - Implemented.** Preserve Yes/No/Skip, editable judgments, failure recovery, study-like non-overlap and submission persistence. **Evidence:** web/src/views/Links.test.tsx 'answering moves straight on to the next pair, and keeps playing', 'skipping puts a pair at the back without answering it', 'keeps answers out of the way, and they can be changed', 'pauses the mix when it starts playing' and 'stopping really stops, and answering afterwards does not start it again' (passed 2026-11-10).
7. **S3-0061-07 - Implemented.** Test discovery filtering, long international lyrics, pairs changing during render and draft target changes. **Evidence:** web/src/views/Links.test.tsx 'shows the whole phrase in its own direction, and a search shows only what matches', 'never plays an obsolete prepared audition after the user skips that pair' and 'can go in a draft instead, and leaves what’s playing alone' (passed 2026-11-10).
8. **S3-0061-08 - Implemented.** Keep Search/Explore return navigation and deep links stable. **Evidence:** web/src/router.ts /discover, /discover/harmonic and /explore aliases; web/src/views/Links.test.tsx 'each have their own address'; web/e2e/pages.e2e.ts 'Back and Forward go where they should' (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Duplicate phrases, Unicode/RTL words, no timed lyrics, result vanishes during approval and stale preview.
- Pair insertion with one ineligible track must fail without partial insert.
- Harmonic verdict submission times out and retries; no duplicate verdict or unexpected addition to mix.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Combine the two into one generic Discovery card to reduce components, but users could mistake rating a harmony for requesting a song. Separate subworkflows improve intent clarity.

## Acceptance and evidence

Every discovery function stays accessible and the distinction between a suggested match, an approved quality judgment and an actual inserted pair remains clear.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (8/8) | Task-by-task evidence on each item; 0 need a person, 0 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
