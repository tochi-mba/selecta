---
id: T-20261125-f9ed
title: Song facts writers on Desktop still use the raw library connection
area: local-app
status: done
priority: later
who: claude
created: 2026-11-25
source: One brain Phase 3, song read slice (PR #154)
commit: aa488c78
---

db.save_analysis, db.save_lyrics, db.upsert_song, the tempo and key correction route (routes/library.py) and scan.py still write songs, analysis, lyrics and song_overrides through sqlite3. Safe today: they write the same file and commit before any engine store read can see them, and load_song reads through the caller's own connection while it has writes pending. Good: each writer moves onto engine_store with the write side of this slice, and the hand-made tables lose their raw writers.

2026-11-26: moved with the library slice (docs/engineering/engine-store-library.md): with core.engine_store on the scan, save_analysis (with its hashes in one write), save_lyrics, the correction route and the library settings write through the store; db.upsert_song is the old path only.
