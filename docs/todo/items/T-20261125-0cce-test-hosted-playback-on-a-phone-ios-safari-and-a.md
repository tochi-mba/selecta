---
id: T-20261125-0cce
title: Test hosted playback on a phone (iOS Safari and Android Chrome)
area: storage
status: open
priority: high
who: either
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

The hosted player hands the browser a tiny FLAC (the file's STREAMINFO and whole frames) for each 8 s window. Chromium plays it (measured); iOS Safari's decoder was not tried. Good: a 12-song hosted mix plays on an iPhone and an Android phone, with joins clean and the page responsive.

2026-11-25: done here (no phone): 390 px with touch emulation in every card state, no sideways scroll, every press 44 px or taller, the bottom navigation clears the card; a window the browser cannot decode, a decoder that never answers and a browser with no Web Audio now stop with plain words. Still open, needs a real iPhone: the six checks in walkthrough section 8.1 (a STREAMINFO-only window decodes exactly at 24 bits; the 44.1 kHz context and sample-exact joins on a 48 kHz device; the ring/silent switch, since the player sets no navigator.audioSession.type; a locked screen or background tab; memory and decode time per window on an older iPhone; resuming the large export download).
