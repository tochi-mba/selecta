---
id: T-20261125-5705
title: Add music drop zone uses a typed plus glyph and has no hover or drag-over state
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit:
---

web/src/cloud/Uploads.tsx near line 179 draws a text plus sign as the icon, and .cloud-drop in web/src/cloud/cloud.css has no hover or drag-over rule. Good: a real Icon, the zone lifts and lights on hover and while a file is dragged over it.
