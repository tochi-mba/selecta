# ADR-190 — Glass Threads: a landscape, live-audio visualizer

**Decision:** Accepted by the product owner on 2026-11-08 as an extension of [PR #33](https://github.com/tochi-mba/selecta/pull/33). **Implementation:** In progress. **Independent verification:** Not yet. No independent tests or external audio/device acceptance have been claimed.

**Parent ADRs:** [ADR-0170 Listen](adr-0170-listen-audio-clock-and-handoffs.md), [ADR-0183 accessibility/performance](adr-0183-responsive-accessibility-and-performance.md), plus [ADR-0188 Recent Spectrum](adr-0188-recent-spectrum.md) for history handling.

**Technical implementation:** `web/src/views/spectrumVisuals.ts` and the existing `Now.tsx` selection and persistence. Tests live in `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, and `web/e2e/creative-visualizers.e2e.ts`.

**Non-regression contract:** Pure display code, never modifies playback, the single audio owner, source files, original music, audio focus, draft/current revisions, transitions, bridge consent, eight-lane Stem Studio, lyric timing, neutral A/B comparison, or FLAC. All samples come from the actual existing mixed-audio `player.getSpectrum()` analyzer. No cover artwork, BPM, genre, beat grid, stem identity, audio-quality ranking, or output state may be invented. A blank analyzer is blank, not a visual demo.

## Context

Five fine horizontal contours occupy separate vertical rails and use the width of the listening scene. This is an alternative to the removed radial view, designed for long screens and usable as a small or large display. The user requested five additional width-friendly choices, approved their ADR direction, and requires the WIP to remain on GitHub.

## Accepted design and data provenance

Divide the actual analyzer bands into five contiguous frequency windows. Each rail receives only magnitudes from its window. Line thickness and vertical location identify the rail, not a separate song, vocal, instrument, or stem. The drawing intentionally avoids any invented modulation or independent animation.

## User interaction and lifecycle

This mode is available through the keyboard-operable **Audio visualizer style** selector beside the existing Frequency Bars, Frequency Ribbon, Aurora Contours, Spectral Lanes, Frequency Constellation and Recent Spectrum. Choosing it stores the `threads` identifier in local browser preferences; it does not start, resume, seek or stop sound.

The visualization paints only when the audio player owns an active sample and the canvas is visible. The parent throttles drawing to at most 15 frames/second and device pixel ratio 2, with one static sample under reduced motion. Visibility, route change, pause, missing analyzer, and change of mode must stop the animation loop and clear any history as appropriate. The mode name is its accessible description; the canvas contains no keyboard-only controls.

## Acceptance criteria

Five visible narrow contours must each use actual samples in their own band, fit inside the wide canvas, and remain distinguishable when their magnitudes differ. Do not label them as stems or songs.

**Required edge cases:** One energetic frequency window, missing bins, flat signal, dark/light/forced colors, screen-reader presentation.

**Rollback:** Choose Spectral Lanes for a simpler filled bar representation of grouped frequency ranges. The original Frequency Bars is always available. No database, audio, or backend rollback is needed.

## Implementation and verification checklist

- [x] Owner approved the design direction and source of truth. This marks design acceptance only.
- [x] The render branch for `threads` is implemented in the WIP branch of PR #33.
- [ ] Unit tests and browser tests run green on the **final commit** for this mode.
- [ ] Review the actual audio response in a browser, including silent/paused/missing samples.
- [ ] Independent keyboard, reduced-motion, contrast, narrow/large viewport, and named-hardware performance sign-off recorded with commit SHA.

The [original 140 CI tasks](selecta-creative-interface-implementation-checklist.md) retain independent implementation/evidence statuses; adding this ADR does **not** automatically check those tasks. Test screenshots are review candidates, not human approval.
