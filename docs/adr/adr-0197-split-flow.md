# ADR-0197 — Split Flow: landscape live-spectrum visualization

**Decision:** Accepted under the user's 2026-11-08 approval for PR #33. **Implementation:** Source present on the PR branch; final CI not yet verified. **Independent verification:** No.

**Related:** [ADR-0170 — real-audio Listen](adr-0170-listen-audio-clock-and-handoffs.md), [ADR-0183 — accessibility and performance](adr-0183-responsive-accessibility-and-performance.md), and the other horizontal visualizer decisions, ADR-0185–0197.

**Source of truth:** Only actual `SetPlayer.getSpectrum()` frequency bins from the single current player. This is a DISPLAY-ONLY choice; no audio, stems, source files, transport, route, bridge consent, library, Mix/Draft revision, lyrics or FLAC generation are changed. The drawing must never pretend to be a beat grid, waveform history, source-separated audio, quality rating or song cover art.

**Controls:** Use the keyboard-accessible 'Audio visualizer style' selector with locally persisted choice, shared with all 15 modes. No extra player buttons or audio contexts. Choosing a style never starts, stops, resumes, seeks or moves playback.

**Performance and motion:** At most 15 frames/sec, device-pixel-ratio capped at 2. Disable the sampling loop for hidden page, offscreen canvas, pause, missing analyzer, unmount and reduced-motion preference; in reduced motion draw only the current static measured sample. Absence of signal produces no fake bars or movement. Forced-color and screen-reader users have an accessible textual identity for the chosen mode.

## Context and user intent

Two independent horizontal river-like bands, lower frequencies above and upper frequencies below. The radial design has already been removed. The user specifically requested four more length-friendly choices, reaching fifteen total.

## Accepted data-to-visual mapping

Split the existing measured spectrum at its midpoint. Draw lower-frequency magnitudes in a full-width upward area above the centerline and upper-frequency magnitudes in an independently sampled downward area below it. The two halves are NOT duplicated or mirrored, and the halves are relative frequency regions, not left/right stereo, separated instruments or calibrated bass channels.

## Acceptance requirements

A sample with energy only in the lower half draws only the upper-region flow. A sample with energy only in the upper half draws only the lower-region flow. With both halves active, both colored strips appear. Silent input is blank.

**Negative and responsive cases:** Check single-sided spectra, both sides active, uneven bin count, quiet input, 320px to full stage, focus/contrast and pause/unmount.

## Implementation and verification

- [x] Owner-approved design: its data mapping, horizontal layout and real-analyzer constraints have been specified.
- [x] WIP implementation added under mode `split` in `web/src/views/spectrumVisuals.ts`.
- [ ] Final source unit test and keyboard selector/persistence test run green at the exact last commit SHA.
- [ ] Real-browser playback and audio-clock regression with an actual track, silence, pause and background tab recorded.
- [ ] Independent narrow/large display, 400% zoom, screen reader, high contrast and measured low-power verification signed off.

**Test touchpoints:** `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, `web/e2e/creative-visualizers.e2e.ts`. Test-writing and a passing automated run are distinct from independent human acceptance.

**Rollback:** Choose Spectral Lanes or Frequency Ribbon from the same selector, or turn off Spectrum; no backend change, data migration, or source audio modification.

The [original 140-task programme](selecta-creative-interface-implementation-checklist.md) is not automatically checked off by visualizer implementation. Every earlier CI task still requires matching implementation evidence and its stated acceptance gate.
