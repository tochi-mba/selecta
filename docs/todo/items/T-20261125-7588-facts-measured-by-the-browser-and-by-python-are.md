---
id: T-20261125-7588
title: Facts measured by the browser and by Python are judged by the same planner gates
area: library
status: open
priority: high
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

planner_core.fit gates (grid confidence 0.8, tempo gap 4.5%) were set from seams whose facts came from the Python analysis. Facts a device sends come from another implementation and may sit on another scale, and one pair can have one song of each. Also undecided: which facts win when a phone and a PC both measured the same song. Good: each facts row carries its implementation id, the better implementation wins for a hash, and the gates are checked on device facts for the same songs before Cloud plans from them.
