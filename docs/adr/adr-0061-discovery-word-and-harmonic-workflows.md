# ADR-0061: Word connections and four-stage harmonic discovery

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 — Discovery and operations
- **Extends existing decisions:** ADR-0019, ADR-0042
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0061-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Word connections match shared lyric phrases with transition previews, ratings and pair insertion. Harmonic discovery uses ordered four-stage auditions and Yes/No/Skip judgments. Their task semantics differ from preset mix browsing and should not be accidentally merged.

## Decision proposed

Place Word Connections and Harmonic Matches under Explore, with their own focused subroutes and honest preview states. Preserve pair atomicity and distinguish a harmonic judgment from adding tracks to an active/draft mix.

## Experience and frontend architecture

- Word cards center the shared phrase and source context, show true render readiness, permit style selection and preview, and maintain selected current/draft insertion target. Pair addition is a single consistent transaction.

- Harmonic listening preserves stages: source chords, first track, transformed second track and combined result. Labels identify what is currently audible; Yes/No/Skip and recovery remain independent of downstream mix insertion.

- A result's musical-fit rating is separate from renderer failures. The UI must never claim a successful connection solely because detection produced a candidate.

## Detailed implementation work (all Not started)

1. **S3-0061-01 — Not started.** Rebuild Word Connections browse hierarchy around readable shared lyric phrase and two source tracks.
2. **S3-0061-02 — Not started.** Preserve available transition moves, preparation, preview, fallback and exact audio-version status.
3. **S3-0061-03 — Not started.** Design clear approve/rate/add-pair actions with current/draft target and atomic insertion.
4. **S3-0061-04 — Not started.** Retain failed or poor connection access with accurate reasons, not fabricated quality judgments.
5. **S3-0061-05 — Not started.** Rebuild harmonic four-stage audition flow with obvious current stage and playback state.
6. **S3-0061-06 — Not started.** Preserve Yes/No/Skip, editable judgments, failure recovery, study-like non-overlap and submission persistence.
7. **S3-0061-07 — Not started.** Test discovery filtering, long international lyrics, pairs changing during render and draft target changes.
8. **S3-0061-08 — Not started.** Keep Search/Explore return navigation and deep links stable.

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

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
