# ADR-0194 - Spectral Dunes: landscape live-spectrum visualization

**Decision:** Accepted under the user's 2026-11-08 approval for PR #33. **Implementation:** Source present on the PR branch; final CI not yet verified. **Independent verification:** No.

**Related:** [ADR-0170 - real-audio Listen](adr-0170-listen-audio-clock-and-handoffs.md), [ADR-0183 - accessibility and performance](adr-0183-responsive-accessibility-and-performance.md), and the other horizontal visualizer decisions, ADR-0185–0197.

**Source of truth:** Only actual `SetPlayer.getSpectrum()` frequency bins from the single current player. This is a DISPLAY-ONLY choice; no audio, stems, source files, transport, route, bridge consent, library, Mix/Draft revision, lyrics or FLAC generation are changed. The drawing must never pretend to be a beat grid, waveform history, source-separated audio, quality rating or song cover art.

**Controls:** Use the keyboard-accessible 'Audio visualizer style' selector with locally persisted choice, shared with all 15 modes. No extra player buttons or audio contexts. Choosing a style never starts, stops, resumes, seeks or moves playback.

**Performance and motion:** At most 15 frames/sec, device-pixel-ratio capped at 2. Disable the sampling loop for hidden page, offscreen canvas, pause, missing analyzer, unmount and reduced-motion preference; in reduced motion draw only the current static measured sample. Absence of signal produces no fake bars or movement. Forced-color and screen-reader users have an accessible textual identity for the chosen mode.

## Context and user intent

Four broad, full-width landscapes instead of tightly packed spectrum columns. The radial design has already been removed. The user specifically requested four more length-friendly choices, reaching fifteen total.

## Accepted data-to-visual mapping

Divide the measured frequency buckets into four consecutive groups. For each group draw its own area under the currently sampled frequency contour, with a thin top stroke and no movement independent of the analyser. The four vertically stacked shapes are frequency partitions, not music stems, separate tracks or an actual energy history.

## Acceptance requirements

Exactly four filled ridge surfaces and four outline strokes when current analyser data exists; each band uses ONLY its own measured frequency window. Same input produces the same geometry. Missing or silent input produces no dunes.

**Negative and responsive cases:** Check 1, 2, 4, 128 and 256 bins; predominantly low or high notes; silence; narrow width; large stage; reduced motion; light, dark and forced colors.

## Implementation and verification

- [x] Owner-approved design: its data mapping, horizontal layout and real-analyzer constraints have been specified.
- [x] WIP implementation added under mode `dunes` in `web/src/views/spectrumVisuals.ts`.
- [ ] Final source unit test and keyboard selector/persistence test run green at the exact last commit SHA.
- [ ] Real-browser playback and audio-clock regression with an actual track, silence, pause and background tab recorded.
- [ ] Independent narrow/large display, 400% zoom, screen reader, high contrast and measured low-power verification signed off.

**Test touchpoints:** `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, `web/e2e/creative-visualizers.e2e.ts`. Test-writing and a passing automated run are distinct from independent human acceptance.

**Rollback:** Choose Frequency Ribbon or Aurora Contours from the same selector, or turn off Spectrum; no backend change, data migration, or source audio modification.

The [original 140-task programme](selecta-creative-interface-implementation-checklist.md) is not automatically checked off by visualizer implementation. Every earlier CI task still requires matching implementation evidence and its stated acceptance gate.
