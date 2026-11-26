---
id: T-20261125-7306
title: Takedown: exports that contain a removed song, and how fast derived copies go
area: legal
status: open
priority: high
who: owner
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 6
commit:
---

What exists: admin/takedowns.py logs a notice, and acting on it tombstones the uploaded song (hidden at once, original purged after the 30-day recovery window, repeat infringers' uploads suspended). Since this change the purge also erases the song's derived copies (analysis, lossless playback file, transition clips: storage/maintenance.song_derivatives). Two decisions are the owner's with legal advice: (1) exports already made that contain the song stay downloadable until their plan retention (7 to 90 days); must a valid notice also remove them? (2) derived copies are unreachable from the moment of the tombstone but stay stored for the 30-day window; is that acceptable for a takedown, or must they be erased at once? Recommendation: erase derived copies at once for a takedown (not for an ordinary delete, which keeps the recovery window), and tombstone exports whose timeline names the song's playback file; both are small once decided.
