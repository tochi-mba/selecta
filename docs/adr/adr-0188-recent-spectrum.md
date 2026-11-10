# ADR-0188 - Recent Spectrum: horizontal live-audio visualization

**Status:** Accepted by the owner, 2026-11-08. Implementation in progress on [PR #33](https://github.com/tochi-mba/selecta/pull/33); authored tests are not independent verification. **Independent verification:** No.

**Scope and invariants:** Existing local-first browser app. No change to audio playback, source music, server data, transitions, mix/draft revisions, requests, Studio, lyric timing, or export. Shapes are display-only. Never infer genre, quality, beat, artwork or new audio from a frequency display.

**Implementation surface:** `web/src/views/spectrumVisuals.ts`, `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, `web/e2e/creative-visualizers.e2e.ts`.

**Common lifecycle:** Sample only `SetPlayer.getSpectrum()` while playback is actually active and visible. At most 15 frames per second and device pixel ratio 2. Cancel on pause, navigation, hidden tab, lost intersection/ownership, or unmount. Under reduced motion draw only the single current sample, with no animation loop. If samples are unavailable or silent, do not invent motion or visible signal. Expose a textual style name and an ordinary keyboard-operated selector. Changes to style persist locally, without seeking, starting, resuming, or changing audio.

**Release/verification gate:** Exercise the named variant with real played music, silence, Pause, background tab, missing analyser, high contrast, reduced motion, long translated text, 320px touch and 400% zoom. Verify audio-clock continuity and no dropped audio on a named slow machine. Automated tests alone do not satisfy real-device/audio/human sign-off. Revert through the existing presentation selector without changing audio.

## Context

An honest short-term history strip of live spectrum frames, not a fabricated timeline or song waveform. The radial display wastes horizontal space and is unsuitable for the Listen scene. The listener explicitly requested four new lengthwise alternatives, with an independently described ADR for each.

## Accepted decision

Accumulate only samples actually delivered to the visualization while playing and visible, max 24 rows. Newest at bottom and older at top; brightness from measured magnitudes. Never seed history or infer samples for missed frames. Label it 'Recent spectrum' rather than beat, waveform, or entire song history.

## Rendering and data provenance

Maintain local array of up to 24 actual frequency frames; append when sampled and clear when the visualizer is torn down, paused, hidden or outside the viewport. No buffering on the server, no storage, and no independent timer. Reduced motion shows a static sample only.

## Accessibility, motion and correctness

**Acceptance:** After 50 measured updates the buffer still has 24; switching style does not mutate history; pause, hidden document, navigation and missing analyzer clear it. No stale stripes show for another song, mix or playback owner.

## Tracked acceptance evidence

- [x] Owner chose this design direction for PR #33; approval is a design decision, not test sign-off.
- [x] Renderer and selectable preference have been authored in the PR branch.
- [x] Source-level unit and browser test cases have been authored for this mode.
- [x] Automated build and tests green at the final code SHA. **Evidence (2026-11-10):** run on the working tree over ad32af8 (renderer `web/src/views/spectrumVisuals.ts` unchanged since that commit): `pnpm exec vitest run src/views/spectrumEdgeCases.test.ts src/views/spectrumVisuals.test.ts` 98 passed, `src/views/Now.test.tsx` 27 passed ("chooses and remembers %s without creating or starting audio"), `vite build` green, and `e2e/creative-visualizers.e2e.ts` 4 passed in Edge, including "the visualizer style is chosen by keyboard and remembered across a reload" and "each horizontal mode paints measured audio, goes blank on pause and stops while hidden". The ADR's own edge cases are in `web/src/views/spectrumEdgeCases.test.ts` under "ADR-0188". Re-run if the renderer changes before merge.
- [ ] Independent named-hardware, accessibility and real-audio review complete. **Needs a person:** an independent reviewer on named hardware with screen reader, high contrast, 400% zoom and measured low-power performance, recording the commit SHA.

## Rollback

Select Frequency bars or Frequency ribbon in Listen display options, or switch off Spectrum entirely; no engine-side state is changed. Remove this render mode without a database migration. This ADR extends [ADR-0170](adr-0170-listen-audio-clock-and-handoffs.md) and [ADR-0183](adr-0183-responsive-accessibility-and-performance.md), with the original [140-task checklist](selecta-creative-interface-implementation-checklist.md) remaining its own separately tracked acceptance programme.
