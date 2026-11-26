---
id: T-20261126-1e71
title: Raw library reads left outside the store, each with a reason
area: local-app
status: open
priority: later
who: claude
created: 2026-11-26
source: One brain Phase 7 library slice, 2026-11-26
commit:
---

After the library slice these still open the library (or a sibling file) with sqlite3 when core.engine_store is on: cache_care.tidy_database (PRAGMA page counts, incremental vacuum, VACUUM, optimize, checkpoint: whole-file maintenance that cannot run inside a store transaction), api.py /api/ready (a read-only probe that the file has the songs table, before anything opens it), and workers/local_seams.py and workers/local_analysis.py (read-only reads of work.sqlite, the job host's store, not the library). engine_store/library.py's stamp_of and path_of read the old connection to find the store. Good: the owner agrees these count as whole-file tools, or each moves (the probe could ask library.stamp_of through the store once the store can open a file read-only).
