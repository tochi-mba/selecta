---
id: T-20261125-344a
title: Count the local cover cache in the storage budget
area: library
status: open
priority: later
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

The cover cache under <home>/art/v1/ (src/selecta/library/art.py) is now tidied by cache_care (_old_covers: markers for file versions no song has, then pictures no marker names), but it is still not counted in the cache budget. stems.cache_roots cannot simply list it: prune_cache treats each subfolder as a removable window and would delete the whole files/ or pictures/ folder. Good: Storage shows the cover cache's size with the other caches, and the cap trims covers least recently used, picture by picture.
