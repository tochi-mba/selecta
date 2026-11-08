# ADR-0055: Calm Listen experience, accurate waveform, lyrics and Stage

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 — Core journeys
- **Extends existing decisions:** ADR-0006, ADR-0008, ADR-0009, ADR-0027, ADR-0039
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0055-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Listen already supports gapless Web Audio playback, transport, section waveform, beat countdown, spectrum, timed lyrics, steering, explanations, transition ratings and Stage. A total visual rebuild must not compromise these audio and timing contracts.

## Decision proposed

Make song identity and transport visually dominant, show upcoming and transition state in a secondary region, and reveal advanced musical context on demand. Treat lyrics focus and Stage as coherent presentation modes rather than separate playback engines.

## Experience and frontend architecture

- Keep one main transport owner and the existing Media Session behavior. Show prepared versus planned transition status, distinguish Jump to transition from Next and avoid false-precision beat countdowns when source data is insufficient.

- Waveform uses existing peak and section data, supports seek with keyboard/ARIA and explains temporary non-seekable seams. Lyrics have timed-word, line-only, untimed, instrumental, failed and missing fallbacks; never animate invented word timing.

- Spectrum is optional atmosphere, throttled and suppressed when hidden/reduced-motion. Stage supports both granted and denied fullscreen, preserves route/transport context and readable metadata at distance.

## Detailed implementation work (all Not started)

1. **S3-0055-01 — Not started.** Redesign song identity, artist, mix identity and stable transport in the Listen layout.
2. **S3-0055-02 — Not started.** Create waveform section markers, playhead, actual seam boundaries, focus/seek and non-seekable feedback.
3. **S3-0055-03 — Not started.** Specify upcoming card with requested/actual transition distinction and real readiness.
4. **S3-0055-04 — Not started.** Preserve Bigger/Calmer/Something else with confirmation, changed plan display and failure recovery.
5. **S3-0055-05 — Not started.** Design lyrics focus with word, line, untimed, instrumental and no-lyrics fallbacks.
6. **S3-0055-06 — Not started.** Preserve spectrum with reduced-motion and hidden-page performance budgets.
7. **S3-0055-07 — Not started.** Redesign Stage for large-screen legibility, fullscreen denial, exit and restoration.
8. **S3-0055-08 — Not started.** Retain exact Good/Bad rating scope and 'Why this transition?' layered explanations.
9. **S3-0055-09 — Not started.** Test transport during navigation, seek, pause, preview, end-of-set and multi-tab takeover.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Gapless timing, invalid audio, late seam, fallback, before/after cue seek, browser Media Session keys.
- No lyrics, wrong/missing timing, very long lines, multilingual content, Stage ESC and fullscreen denial.
- Steering race with user skipping, requests and background render; correct next song and one audio owner.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A wholly new visual audio engine is not required; preserve the existing player while rebuilding the view model and composition. Prioritize useful listening clarity over decorative motion.

## Acceptance and evidence

Listening hierarchy is easier to scan while measured playback timing, audio focus, section seek and all lyric modes remain unchanged or improved.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
