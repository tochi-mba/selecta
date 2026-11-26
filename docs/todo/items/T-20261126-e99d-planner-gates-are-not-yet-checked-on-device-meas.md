---
id: T-20261126-e99d
title: Planner gates are not yet checked on device-measured facts
area: library
status: open
priority: high
who: claude
created: 2026-11-26
source: Cloud planning, PR #159 (rest of T-20261125-7588)
commit:
---

planner_core.fit gates (grid confidence 0.8, tempo gap 4.5 percent) were set from Python-measured seams. Cloud now plans from web-dsp-1 facts. Good: the device golden fixtures measured by both implementations, the gates compared on each, and either a per-implementation scale or a recorded finding that they agree.
