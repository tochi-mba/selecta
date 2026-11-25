---
id: T-20261125-e103
title: Song features are stored twice on Desktop with core.engine_store on
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain Phase 3, song read slice (PR #154)
commit:
---

With the flag on, analysis writes features/{song_id}.npz as before and also publishes the same file to artifacts/ under its content key (engine_store.songs.features_key). The old file is kept so the flag can go off and so songs analysed before stay readable. cache_care does not sweep artifacts/ for songs that were removed. Good: once the flag is the default, stop writing the old file, move or drop the old files in one backed-up step, and teach cache_care the content keys.
