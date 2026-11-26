---
id: T-20261126-4031
title: Set the made-ahead clip's safety thresholds by ear, and count how often each one refuses
area: devices
status: open
priority: high
who: owner
created: 2026-11-26
source: docs/engineering/device-studio-playback.md
commit:
---

Three thresholds that keep a made-ahead clip from playing were chosen from reasoning, not from listening: a join whose clip side differs from the native song by more than half its level (renderedSeam.ts JOIN_TOLERANCE), a clip more than 2 dB louder than the louder neighbouring song or 20 dB quieter than the quieter one (seamMaker.ts). Too strict and good clips fall back to the live transition; too loose and a bad join could play. Also unknown: whether the first song of a start, whose level can arrive after the engine stopped waiting for it (scheduler FIRST_LEVEL_WAIT_MS), often loses its clip to the level check. Good: listen to a few mixes in the Listening Room with cloud.device_render on, read the dev console's one line per seam for how often each refusal fires, and set the numbers from that.
