---
id: T-20261125-24ff
title: Planner modules import the renderer and the stem separator
area: local-app
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0479 and the owner's plan approval, 2026-11-25
commit:
---

planner/choose.py imports render.engine; planner/beam.py imports wordreel, which pulls in sqlite3, soundfile and stems; vibes.py imports arrange and render.intertwine. So the planner cannot run from song facts alone. Good looks like: a planner core with an import test, taking facts, flags and seam memory as arguments. ADR-0479 phase 4.
