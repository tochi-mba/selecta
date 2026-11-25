---
id: T-20261125-f37b
title: Nothing writes Cloud song facts into the engine store yet
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain Phase 3, song read slice (PR #154)
commit:
---

Cloud now has the analysis and song_overrides tables (es0479song01) and engine_store.songs can read a catalogue song's facts, but nothing writes them: hosted analysis (workers/engine_handlers.analyse) stores an analysis.npz artifact under its own input hash and returns a summary, and a browser-first member's device analysis is not uploaded as facts. The features key there also differs (kind analysis, attempt folders, a manifest row) from engine_store.songs.features_key (kind features, one slot). Good: the analysis write moves onto the store in its own slice, writing the analysis row and publishing features under features_key (with provenance in Cloud), so load_song works for a Cloud song end to end.
