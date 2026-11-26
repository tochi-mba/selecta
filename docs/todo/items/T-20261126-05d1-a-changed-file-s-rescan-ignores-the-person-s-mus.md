---
id: T-20261126-05d1
title: A changed file's rescan ignores the person's music choice for that scan
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: One brain Phase 7 library slice, 2026-11-26
commit:
---

library/scan.py applies music_override only to files whose size and time are unchanged: a re-tagged or replaced file is classified afresh, so a song someone set aside (or marked as music) flips back until the next rescan, though music_override itself survives. Both paths do this (the store path keeps it, to match the old path row for row). Good: the scan applies the stored override to a changed file too, with a test on both paths.
