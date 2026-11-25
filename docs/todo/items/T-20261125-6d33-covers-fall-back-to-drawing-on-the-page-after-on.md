---
id: T-20261125-6d33
title: Covers fall back to drawing on the page after one worker failure
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Import freeze hunt, 2026-11-25
commit:
---

web/src/media/art.ts makeArtOffPage: one worker timeout (20 s, easy to hit on a busy 4-core laptop) sets workerBroken for the rest of the visit, and every later cover is decoded, scaled with high-quality smoothing and encoded on the main thread (CPU only on a machine without a usable GPU). Respawn the worker a few times before giving up, or skip covers instead of drawing them on the page.
