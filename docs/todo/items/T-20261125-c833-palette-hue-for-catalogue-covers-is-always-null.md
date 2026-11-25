---
id: T-20261125-c833
title: Palette hue for catalogue covers is always null: Pillow is not a dependency
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25 (ADR-0478 catalogue)
commit:
---

catalog.service.palette_hue imports PIL lazily and returns null without it, so ambient colour from a web cover falls back to the hashed hue. Good: decide whether to add Pillow to the cloud extra or compute the hue in the browser on first display and report it back.
