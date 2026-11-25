---
id: T-20261125-cb43
title: importNeverDeletes test's art.ts import list misses ./breathe
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Artwork edge-case fixes, 2026-11-25
commit:
---

web/src/media/importNeverDeletes.test.ts expects art.ts to import exactly ../flags, ./artStore, ./artWorker and ./tags, but art.ts also imports ./breathe (seen on feat/feel-edges at 217da733, not touched by the artwork fixes). Either the test list gains ./breathe or the import goes; check whether CI is already red on it.
