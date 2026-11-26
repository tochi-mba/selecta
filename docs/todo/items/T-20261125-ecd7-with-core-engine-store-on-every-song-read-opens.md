---
id: T-20261125-ecd7
title: With core.engine_store on, every song read opens a new database connection
area: local-app
status: done
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit: 65276db2
---

engine_store.library uses a NullPool engine, so each load_song and load_features connects, sets its PRAGMAs and closes. Planning reads hundreds of songs. Good: measure planning a 500 song library with the flag on and off; if it is slower, hold one read connection per thread, released before a restore replaces the file.

2026-11-26: measured on synthetic data, flag off against on: a 500-song plan load 1.48 s and 4.29 s before, 1.40 s after; an unchanged 1,000-file rescan 0.46 s and 0.32 s after. The library engine now keeps up to four idle connections (a nested read takes another), one store per file, a plan's changed songs read in one transaction; backup.activate_pending_restore calls library.forget first (tested). docs/engineering/engine-store-library.md.
