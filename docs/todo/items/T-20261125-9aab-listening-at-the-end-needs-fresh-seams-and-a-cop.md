---
id: T-20261125-9aab
title: Listening at the end needs fresh seams and a copy of the library
area: local-app
status: open
priority: high
who: owner
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Seams already rendered keep their old audio, because the seam key does not include render.one_engine, so a listening session on the existing library would compare old with old. core.engine_store must first be proved on a copy of the real library. With many flags changed at once a bad seam cannot be traced to one change. Good: the listening session runs on a copy, with seams cleared, one flag changed per reel, at matched loudness, and its ratings are saved where the calibration job reads them.
