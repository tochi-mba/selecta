# ADR-0055: Calm Listen experience, accurate waveform, lyrics and Stage

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 9 of 9 tasks implemented with automated evidence on 2026-11-11; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 3 - Core journeys
- **Extends existing decisions:** ADR-0006, ADR-0008, ADR-0009, ADR-0027, ADR-0039
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Listen already supports gapless Web Audio playback, transport, section waveform, beat countdown, spectrum, timed lyrics, steering, explanations, transition ratings and Stage. A total visual rebuild must not compromise these audio and timing contracts.

## Decision proposed

Make song identity and transport visually dominant, show upcoming and transition state in a secondary region, and reveal advanced musical context on demand. Treat lyrics focus and Stage as coherent presentation modes rather than separate playback engines.

## Experience and frontend architecture

- Keep one main transport owner and the existing Media Session behavior. Show prepared versus planned transition status, distinguish Jump to transition from Next and avoid false-precision beat countdowns when source data is insufficient.

- Waveform uses existing peak and section data, supports seek with keyboard/ARIA and explains temporary non-seekable seams. Lyrics have timed-word, line-only, untimed, instrumental, failed and missing fallbacks; never animate invented word timing.

- Spectrum is optional atmosphere, throttled and suppressed when hidden/reduced-motion. Stage supports both granted and denied fullscreen, preserves route/transport context and readable metadata at distance.

## Detailed implementation work

1. **S3-0055-01 - Implemented.** Redesign song identity, artist, mix identity and stable transport in the Listen layout. **Evidence:** web/src/views/Now.tsx; web/e2e/pages.e2e.ts 'on a phone, Listen keeps display options after the song identity and transport reachable'; web/src/views/Now.test.tsx 'keeps expert view controls discoverable without competing with playback' (passed 2026-11-10).
2. **S3-0055-02 - Implemented.** Create waveform section markers, playhead, actual seam boundaries, focus/seek and non-seekable feedback. **Evidence:** named sections and seam marker in web/src/views/Now.tsx; web/src/views/Now.test.tsx 'keeps a finite, disabled slider and never attempts a seek', 'previews the target without seeking until release' and 'shows bars and the current beat against the analyzed grid'; web/e2e/listen.e2e.ts 'seeking moves within the song, and doesn’t set off the transition' (passed 2026-11-10).
3. **S3-0055-03 - Implemented.** Specify upcoming card with requested/actual transition distinction and real readiness. **Evidence:** TransitionTruth in web/src/views/Now.tsx; web/src/ui/MusicObjects.test.tsx 'uses the rendered move rather than disguising a fallback as the selected technique' and 'never calls an automatic unrendered transition a confirmed technique'; web/src/views/Now.test.tsx 'uses chronological seconds when the next handoff has no valid beat grid' (passed 2026-11-10).
4. **S3-0055-04 - Implemented.** Preserve Bigger/Calmer/Something else with confirmation, changed plan display and failure recovery. **Evidence:** web/src/views/Now.test.tsx 'blocks overlapping steering presses until the first server change finishes' and 'keeps the planned next song, says what went wrong, and can be pressed again' (passed 2026-11-10).
5. **S3-0055-05 - Implemented.** Design lyrics focus with word, line, untimed, instrumental and no-lyrics fallbacks. **Evidence:** noLyricsWords and Lyrics in web/src/views/Now.tsx; web/src/views/Now.test.tsx 'follows the current playback time and keeps the lyric punctuation', 'keeps line lyrics visible when word timing is unavailable', 'labels untimed lyrics as untimed' and 'says why for a %s song, and invents no timing' (instrumental, not looked up, failed, none) (passed 2026-11-10).
6. **S3-0055-06 - Implemented.** Preserve spectrum with reduced-motion and hidden-page performance budgets. **Evidence:** reduced motion: web/e2e/finishing.e2e.ts 'with reduced motion nothing keeps moving by itself, on any page'; hidden page and the 15 frames a second cap in web/src/views/Now.tsx MusicVisualizer: web/e2e/creative-visualizers.e2e.ts 'each horizontal mode paints measured audio, goes blank on pause and stops while hidden' (no more than 34 paints in 2 s, none while hidden, audio clock still running); paint cap: web/src/views/spectrumEdgeCases.test.ts (passed 2026-11-11).
7. **S3-0055-07 - Implemented.** Redesign Stage for large-screen legibility, fullscreen denial, exit and restoration. **Evidence:** web/e2e/finishing.e2e.ts 'fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops'; web/e2e/listen.e2e.ts 'lyrics follow the song, and the fullscreen view keeps everything working'; web/e2e/pages.e2e.ts 'nothing goes wider than the window, from the smallest phone to 4K' (large-screen legibility as judged by a person is not claimed) (passed 2026-11-10).
8. **S3-0055-08 - Implemented.** Retain exact Good/Bad rating scope and 'Why this transition?' layered explanations. **Evidence:** web/src/views/Now.test.tsx 'rates the transition that just played, by its key, and explains what was measured'; web/src/views/Mix.test.tsx 'posts to that seam alone, and shows the saved rating again after a remount' (passed 2026-11-10).
9. **S3-0055-09 - Implemented.** Test transport during navigation, seek, pause, preview, end-of-set and multi-tab takeover. **Evidence:** web/e2e/listen.e2e.ts 'moving around the app leaves the music alone, and the mini-player follows', 'seeking while paused stays paused', 'a preview takes the sound, and gives it back when it’s done', 'the end of the mix comes to a stop, and it can be played again' and 'only one tab plays at a time' (passed 2026-11-10).

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
| 2026-11-10 | Accepted | In progress (8/9) | Task-by-task evidence on each item; 0 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
