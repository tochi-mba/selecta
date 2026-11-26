---
id: T-20261125-33fe
title: Beat bus: a kind pushed out by the four-target cap never comes back
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit: 54579e03
---

web/src/feel/beatBus.ts:299-302 evicts the oldest target when a fifth kind registers, but unlike the same-kind case (293-298) it is not queued in waiting, so when the newer one lets go the evicted one stays silent. Example: the Shell's ring, edge and bars plus a playing row, then Listen's glow, evicts the ring; closing Listen does not bring it back until the Shell effect re-runs. Fix: queue the cap-evicted target too and restore it when a slot frees.
