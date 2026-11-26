---
id: T-20261126-755e
title: Set planner: offer loop room and tempo bridge in a mix's move choice
area: local-app
status: open
priority: later
who: claude
created: 2026-11-26
source: Transition craft II (One brain phase 8), feat/one-brain-5
commit:
---

With their flags on, loop_room and tempo_bridge reach every seam planned with Let SelectaDJ pick (planner_core/choose.py enumerate_candidates: Desktop choose_transition, Cloud planning, the browser's rendered path). The set planner's per-seam move choice (planner_core/vibes.py MOVE_WEIGHTS and FAMILIES) does not list them, and vibes.py is at its size limit. Once the owner rates them up, add them there (loop_room in the blend family), splitting vibes.py first.
