---
id: T-20261125-1384
title: Prune the local cover cache
area: library
status: done
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit: 217da733
---

FL-0478-02 keeps each song file's own cover under <home>/art/v1/ (src/selecta/library/art.py): one small marker per file version in files/ and each distinct picture once in pictures/. Markers and pictures for files that changed or left the library are never removed, so the folder slowly grows on a library that is often retagged. Add a tidy step (for example with cache_care or after a scan) that removes markers whose file version is gone and pictures no marker names, and count the folder in the storage budget. Also: useSongArt consumers outside CoverArt (the Listen hero hue, the lock screen in audio/mediaSession.ts) only see device-kept art, not the local server's or the catalogue's rung; that belongs with FL-0478-05.
