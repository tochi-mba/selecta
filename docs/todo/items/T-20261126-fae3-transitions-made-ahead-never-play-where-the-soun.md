---
id: T-20261126-fae3
title: Transitions made ahead never play where the sound card opens at a rate other than 44.1 kHz
area: devices
status: open
priority: normal
who: either
created: 2026-11-26
source: docs/engineering/device-studio-playback.md
commit:
---

The device renderer works at 44,100 Hz only (render/script.ts SAMPLE_RATE), and the engine asks the browser for a 44.1 kHz AudioContext (engine/context.ts). A browser or output that opens the context at another rate decodes the songs at that rate, so the seam maker refuses every seam there and playback stays on the live transitions. Nobody has measured how often that happens. Good: count it (the dev console line says why there is no clip), and if it is common either render at the context's rate or resample the windows and the clip with a stated, measured loss.
