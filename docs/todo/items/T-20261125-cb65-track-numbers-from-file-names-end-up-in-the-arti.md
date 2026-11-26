---
id: T-20261125-cb65
title: Track numbers from file names end up in the artist
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/cloud-library-walkthrough.md
commit:
---

Uploaded files named '015. Harry Styles - As It Was.mp3' show the artist as '015. Harry Styles': the track number is kept in the artist. Strip a leading track number when the name is read.
