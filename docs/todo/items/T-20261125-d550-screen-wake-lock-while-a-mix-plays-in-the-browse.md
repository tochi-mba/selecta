---
id: T-20261125-d550
title: Screen wake lock while a mix plays in the browser on a phone or tablet
area: devices
status: done
priority: normal
who: claude
created: 2026-11-25
source: Background running and install, 2026-11-25
commit: a238aee7
---

devices/wakeLock.ts (holdWakeLock) is used only by usePlaybackDevice.ts (the speaker device). The local-first browser player (cloud/localFirstPlayer.ts) holds no wake lock, so a phone or tablet playing a mix can lock its screen; on iOS that can stop audio. Hold a screen wake lock while this device is the speaker and the mix is playing, release it on pause, and take it again on visibilitychange (the browser drops it when the tab is hidden). Playback files were off limits in this pass.
