---
id: T-20261125-3d9f
title: Add music overflows at phone width and keeps stale unfinished uploads
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/cloud-library-walkthrough.md
commit: b78ddb01
---

At 390 px the Add music card is wider than the screen (the page scrolls sideways by about 17 px; screenshot m-bad-upload-5.png). Unfinished uploads also keeps listing files that were skipped as duplicates and are already in the Library.

2026-11-26: The overflow: the sweep found Add music up to 718px past a 320px window with a long file name; fixed in b78ddb01 and 8c99322c and held by the layout sweep. The stale unfinished list is its own item now.
