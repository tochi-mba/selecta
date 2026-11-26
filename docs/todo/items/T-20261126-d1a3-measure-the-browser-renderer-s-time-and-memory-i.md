---
id: T-20261126-d1a3
title: Measure the browser renderer's time and memory in a worker on a tablet and a phone
area: devices
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-render.md
commit:
---

Render times so far were measured only under node on the development laptop (Intel 8-thread, single thread used): 0.8 to 8.4 s per clip of 12 to 37 s, audit 0.5 to 2.3 s. Working memory was counted from the code (about ten clip-sized stereo buffers at the busiest moment), not measured. Good: the render worker timed and its peak memory read (performance.measureUserAgentSpecificMemory or the browser's task manager) on an iPad and a mid-range phone for a 16-bar blend, a filter sweep and a stem seam, recorded in docs/engineering/device-render.md, before playback renders ahead in play order.
