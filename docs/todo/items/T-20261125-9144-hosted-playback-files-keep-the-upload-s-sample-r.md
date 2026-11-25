---
id: T-20261125-9144
title: Hosted playback files keep the upload's sample rate, so a 48 kHz song is resampled by the browser and by the export differently
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted export work, walkthrough section 9
commit:
---

play.proxy makes its FLAC at the asset's own sample rate (proxies.prepare passes asset.sample_rate), while seams and cue points are at the engine's 44.1 kHz. The browser resamples such a part with its own resampler and the export (workers/export_join.py) with soxr, so those parts are the same music but not the same samples, and the export of that part is not sample-exact. Good: playback files at 44.1 kHz always (a PROXY_VERSION bump), so the player and export read the same samples.
