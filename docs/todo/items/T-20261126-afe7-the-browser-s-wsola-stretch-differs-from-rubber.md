---
id: T-20261126-afe7
title: The browser's WSOLA stretch differs from Rubber Band enough to move audit numbers, and refuses more than 60 s of source
area: devices
status: open
priority: high
who: claude
created: 2026-11-26
source: docs/engineering/device-render.md (device render golden fixtures, family b)
commit:
---

web/src/dsp/render renders stretched transitions through web/src/dsp/stretch.ts (WSOLA) where the Desktop uses Rubber Band. On the three stretched fixtures every audit verdict matched, loudness was within 0.19 LU, but only 77 to 94 percent of the Desktop's onsets had a browser onset within 10 ms (median 0 to 2.9 ms, worst 44 ms), beat alignment read up to 5 ms apart, the true peak 0.39 dB apart on one, and the drift the renderer corrects was 9 to 11 ms against Rubber Band's 3 to 22. WSOLA also refuses more than 60 s of input, so a 32-bar blend cannot be rendered on the device. Good: a stretcher measured against Rubber Band on web/src/dsp/golden/device-render (Rubber Band WASM or Signalsmith, which needs the owner's permission to download), injected as a render/warpStretch.ts Stretcher with its own id, with no length cap below a long blend.
