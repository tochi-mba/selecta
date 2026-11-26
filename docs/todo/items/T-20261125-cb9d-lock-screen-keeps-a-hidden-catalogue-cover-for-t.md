---
id: T-20261125-cb9d
title: Lock screen keeps a hidden catalogue cover for the rest of the playing song
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: T-20261125-7375 follow-up, 2026-11-25
commit:
---

web/src/audio/mediaSession.ts keeps artFor (the playing song's cover) until the song changes, so a catalogue cover staff hide stays on the lock screen and system controls for the rest of that song. media/catalogArt.ts now expires answers after 30 minutes and drops a broken image at once, but audio/ was outside the worker's allowed files. Fix: let catalogArt.ts offer a subscription (or a version number) that changes when any answer changes, and have mediaSession.ts clear artFor and set the metadata again when it changes for the playing song.
