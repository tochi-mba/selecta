---
id: T-20261125-d7a5
title: Check lock-screen controls and artwork for the browser player
area: devices
status: open
priority: normal
who: claude
created: 2026-11-25
source: Background running and install, 2026-11-25
commit:
---

audio/mediaSession.ts exists and App/Shell use useMediaKeys. Confirm on a phone and on Windows that the local-first Cloud player sets metadata (title, artist, cover from useSongArt), playbackState and the previoustrack/nexttrack/play/pause/seekto handlers, so a mix can be controlled while the tab is hidden or the screen is locked. Not checked in this pass because the playback files were being edited by another worker.
