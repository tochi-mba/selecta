# ADR-192 - Spectrum Mosaic: a landscape, live-audio visualizer

**Decision:** Accepted by the product owner on 2026-11-08 as an extension of [PR #33](https://github.com/tochi-mba/selecta/pull/33). **Implementation:** Implemented; automated unit, build and browser tests green on 2026-11-10. **Independent verification:** Not yet. No independent tests or external audio/device acceptance have been claimed.

**Parent ADRs:** [ADR-0170 Listen](adr-0170-listen-audio-clock-and-handoffs.md), [ADR-0183 accessibility/performance](adr-0183-responsive-accessibility-and-performance.md), plus [ADR-0188 Recent Spectrum](adr-0188-recent-spectrum.md) for history handling.

**Technical implementation:** `web/src/views/spectrumVisuals.ts` and the existing `Now.tsx` selection and persistence. Tests live in `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, and `web/e2e/creative-visualizers.e2e.ts`.

**Non-regression contract:** Pure display code, never modifies playback, the single audio owner, source files, original music, audio focus, draft/current revisions, transitions, bridge consent, eight-lane Stem Studio, lyric timing, neutral A/B comparison, or FLAC. All samples come from the actual existing mixed-audio `player.getSpectrum()` analyzer. No cover artwork, BPM, genre, beat grid, stem identity, audio-quality ranking, or output state may be invented. A blank analyzer is blank, not a visual demo.

## Context

A landscape grid of tiny magnitude-coded color tiles, with frequency increasing across the width. This is an alternative to the removed radial view, designed for long screens and usable as a small or large display. The user requested five additional width-friendly choices, approved their ADR direction, and requires the WIP to remain on GitHub.

## Accepted design and data provenance

Each live analyzer bucket occupies a column. A maximum of six tiles from bottom to top shows quantized current magnitude. This is a PRESENT-FRAME frequency display, not a historical spectrogram or heatmap of past music. The tile count and color derive only from the bucket's measured value.

## User interaction and lifecycle

This mode is available through the keyboard-operable **Audio visualizer style** selector beside the existing Frequency Bars, Frequency Ribbon, Aurora Contours, Spectral Lanes, Frequency Constellation and Recent Spectrum. Choosing it stores the `matrix` identifier in local browser preferences; it does not start, resume, seek or stop sound.

The visualization paints only when the audio player owns an active sample and the canvas is visible. The parent throttles drawing to at most 15 frames/second and device pixel ratio 2, with one static sample under reduced motion. Visibility, route change, pause, missing analyzer, and change of mode must stop the animation loop and clear any history as appropriate. The mode name is its accessible description; the canvas contains no keyboard-only controls.

## Acceptance criteria

Tile columns and occupied row count must match deterministic magnitude thresholds. Empty bins draw nothing; changing a single bin changes only its column. The mode must never silently claim time history.

**Required edge cases:** Threshold edges at 0, 1/6, 1/2 and 1; very narrow canvas, reduced motion, sparse/quiet bins and high-contrast theme.

**Rollback:** Choose Recent Spectrum if actual time history rather than a current-frame mosaic is desired. The original Frequency Bars is always available. No database, audio, or backend rollback is needed.

## Implementation and verification checklist

- [x] Owner approved the design direction and source of truth. This marks design acceptance only.
- [x] The render branch for `matrix` is implemented in the WIP branch of PR #33.
- [x] Unit tests and browser tests run green on the **final commit** for this mode. **Evidence (2026-11-10):** run on the working tree over ad32af8 (renderer `web/src/views/spectrumVisuals.ts` unchanged since that commit): `pnpm exec vitest run src/views/spectrumEdgeCases.test.ts src/views/spectrumVisuals.test.ts` 98 passed, `src/views/Now.test.tsx` 27 passed ("chooses and remembers %s without creating or starting audio"), `vite build` green, and `e2e/creative-visualizers.e2e.ts` 4 passed in Edge, including "the visualizer style is chosen by keyboard and remembered across a reload" and "each horizontal mode paints measured audio, goes blank on pause and stops while hidden". The ADR's own edge cases are in `web/src/views/spectrumEdgeCases.test.ts` under "ADR-0192". Re-run if the renderer changes before merge.
- [ ] Review the actual audio response in a browser, including silent/paused/missing samples. **Needs a person:** listening with the owner's real music, judging that the shapes follow what is heard. Automated part done 2026-11-10: `e2e/creative-visualizers.e2e.ts` "each horizontal mode paints measured audio, goes blank on pause and stops while hidden" checks lit pixels from the synthesized library's real analyser, a blank canvas on Pause, no paints while the tab is hidden with the audio clock still advancing, and at most 15 paints a second; missing and silent samples are covered in `web/src/views/spectrumEdgeCases.test.ts`. The ADR's release gate says automated tests alone do not satisfy this.
- [ ] Independent keyboard, reduced-motion, contrast, narrow/large viewport, and named-hardware performance sign-off recorded with commit SHA. **Needs a person:** an independent reviewer on named hardware with screen reader, high contrast, 400% zoom and measured low-power performance, recording the commit SHA.

The [original 140 CI tasks](selecta-creative-interface-implementation-checklist.md) retain independent implementation/evidence statuses; adding this ADR does **not** automatically check those tasks. Test screenshots are review candidates, not human approval.
