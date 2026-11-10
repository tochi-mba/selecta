# ADR-0187 - Frequency Constellation: horizontal live-audio visualization

**Status:** Accepted by the owner, 2026-11-08. Implemented on [PR #33](https://github.com/tochi-mba/selecta/pull/33); automated unit, build and browser tests green on 2026-11-10; authored tests are not independent verification. **Independent verification:** No.

**Scope and invariants:** Existing local-first browser app. No change to audio playback, source music, server data, transitions, mix/draft revisions, requests, Studio, lyric timing, or export. Shapes are display-only. Never infer genre, quality, beat, artwork or new audio from a frequency display.

**Implementation surface:** `web/src/views/spectrumVisuals.ts`, `web/src/views/Now.tsx`, `web/src/styles/listening.css`; `web/src/views/spectrumVisuals.test.ts`, `web/src/views/Now.test.tsx`, `web/e2e/creative-visualizers.e2e.ts`.

**Common lifecycle:** Sample only `SetPlayer.getSpectrum()` while playback is actually active and visible. At most 15 frames per second and device pixel ratio 2. Cancel on pause, navigation, hidden tab, lost intersection/ownership, or unmount. Under reduced motion draw only the single current sample, with no animation loop. If samples are unavailable or silent, do not invent motion or visible signal. Expose a textual style name and an ordinary keyboard-operated selector. Changes to style persist locally, without seeking, starting, resuming, or changing audio.

**Release/verification gate:** Exercise the named variant with real played music, silence, Pause, background tab, missing analyser, high contrast, reduced motion, long translated text, 320px touch and 400% zoom. Verify audio-clock continuity and no dropped audio on a named slow machine. Automated tests alone do not satisfy real-device/audio/human sign-off. Revert through the existing presentation selector without changing audio.

## Context

A horizontal field of frequency points connected into a musical-looking but data-honest map. The radial display wastes horizontal space and is unsuitable for the Listen scene. The listener explicitly requested four new lengthwise alternatives, with an independently described ADR for each.

## Accepted decision

Place deterministic points along increasing measured frequency. Each point's elevation and size depend only on its sampled magnitude; only present points connect. No random location, blinking, independent orbit or simulated beat.

## Rendering and data provenance

Sample no more than 42 representative bins per paint, skipping zero magnitude. Connect real active points with a fine continuous stroke; draw translucent dots sized from magnitude. Cap sampling and point count so a large screen does not drive expensive canvas effects.

## Accessibility, motion and correctness

**Acceptance:** Identical bins always yield identical point geometry; absent or zero samples yield no dots or links; variation follows actual analyzer changes. Check low/high resolution, color independence and canvas focus safety.

## Tracked acceptance evidence

- [x] Owner chose this design direction for PR #33; approval is a design decision, not test sign-off.
- [x] Renderer and selectable preference have been authored in the PR branch.
- [x] Source-level unit and browser test cases have been authored for this mode.
- [x] Automated build and tests green at the final code SHA. **Evidence (2026-11-10):** run on the working tree over ad32af8 (renderer `web/src/views/spectrumVisuals.ts` unchanged since that commit): `pnpm exec vitest run src/views/spectrumEdgeCases.test.ts src/views/spectrumVisuals.test.ts` 98 passed, `src/views/Now.test.tsx` 27 passed ("chooses and remembers %s without creating or starting audio"), `vite build` green, and `e2e/creative-visualizers.e2e.ts` 4 passed in Edge, including "the visualizer style is chosen by keyboard and remembered across a reload" and "each horizontal mode paints measured audio, goes blank on pause and stops while hidden". The ADR's own edge cases are in `web/src/views/spectrumEdgeCases.test.ts` under "ADR-0187". Re-run if the renderer changes before merge.
- [ ] Independent named-hardware, accessibility and real-audio review complete. **Needs a person:** an independent reviewer listening to real audio on named hardware, with screen reader, high contrast, 400% zoom and measured low-power performance, recording the commit SHA.

## Rollback

Select Frequency bars or Frequency ribbon in Listen display options, or switch off Spectrum entirely; no engine-side state is changed. Remove this render mode without a database migration. This ADR extends [ADR-0170](adr-0170-listen-audio-clock-and-handoffs.md) and [ADR-0183](adr-0183-responsive-accessibility-and-performance.md), with the original [140-task checklist](selecta-creative-interface-implementation-checklist.md) remaining its own separately tracked acceptance programme.
