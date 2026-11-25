---
id: T-20261125-5759
title: Hosted export pool is sized for the old re-rendering export
area: infra
status: open
priority: later
who: claude
created: 2026-11-25
source: hosted export work, walkthrough section 9
commit:
---

The export pool (infra/workers/pools.json, infra/modal/selecta_workers.py EXPORT) has 4 vCPU and 8 GB and a 3600 s Modal timeout, sized for render.setmix. export.render version 2 only downloads and joins FLAC files (about 8 s for a 9-minute mix on one core plus downloads). Good: 1 to 2 vCPU, 2 GB, a timeout matching the 30-minute job limit, after one export is timed on a real worker.
