---
id: T-20261126-96d3
title: Export should play the same transitions made ahead that playback plays
area: devices
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-studio-playback.md
commit:
---

The browser's offline export (web/src/engine/render.ts) joins songs with its own short equal-power crossfade on every boundary and never reaches a seam at all. With cloud.device_render on, a mix played here uses the clips made ahead (deviceStudio.ts, clipStore.ts), so an export of the same mix sounds different from what was heard. Good: export plays native A, the stored clip and native B with the same joins and levels as the scheduler (engine/renderedSeam.ts), and falls back to today's crossfade where no clip is stored.
