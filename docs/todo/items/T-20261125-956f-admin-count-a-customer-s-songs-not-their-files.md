---
id: T-20261125-956f
title: Admin: count a customer's songs, not their files
area: admin
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0469 amendment 2
commit:
---

src/selecta/admin/read_models.py counts local_songs rows for a customer's song count. A song with several files (the same song in two chart folders) is one song: count through selecta.local_media.versions.listed_songs (live primaries only). tests/test_local_media_versions.py lists this module as a known reader; drop it from that list once it goes through listed_songs.
