---
id: T-20261125-5dc9
title: Hosted playback streams lossless audio to phones: design a compressed stream
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 1
commit:
---

What is wrong: the hosted player reads only the lossless playback files (24-bit FLAC, about 11.7 MB a minute), so an hour's mix is about 700 MB on a phone plan. What good looks like: a data saver stream chosen on a metered or slow connection (navigator.connection saveData or effectiveType, plus a setting), lossless kept on Wi-Fi and for exports. Recommendation (design only, not built): a second derived file per song and per seam clip, Opus in Ogg at about 160 kb/s (about 1.2 MB a minute), made by a cpu-light job beside play.proxy; the player reads it by Ogg page granule positions (exact sample positions, pre-skip known) so joins stay sample-exact the way flacFrames.ts does for FLAC. Check first on iOS Safari which lossy container decodeAudioData takes in windows (Ogg Opus support is recent there; AAC in MP4 has encoder padding to trim). Costs: one more short cpu-light job per song and about 6 MB a song of derived storage.
