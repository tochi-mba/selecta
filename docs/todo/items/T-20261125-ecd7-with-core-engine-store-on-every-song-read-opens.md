---
id: T-20261125-ecd7
title: With core.engine_store on, every song read opens a new database connection
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

engine_store.library uses a NullPool engine, so each load_song and load_features connects, sets its PRAGMAs and closes. Planning reads hundreds of songs. Good: measure planning a 500 song library with the flag on and off; if it is slower, hold one read connection per thread, released before a restore replaces the file.
