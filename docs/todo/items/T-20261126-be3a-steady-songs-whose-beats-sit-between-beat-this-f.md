---
id: T-20261126-be3a
title: Steady songs whose beats sit between Beat This frames read as moving
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-analysis.md (device studio, phase 5)
commit:
---

beats._constant_grid searches 3 percent either side of the median beat gap. When a steady song's beats fall midway between Beat This's 20 ms frames, the reported beats alternate 10 ms early and late, the median gap at 120 BPM is 0.52 s, and 0.50 s is never tried: the song is stored as moving (constant_tempo 0, 119.87 BPM) and gets the smoothed grid. The golden fixture house-120-a-minor reproduces it. Good: the period search starts from a robust estimate (the mean gap of the middle half, or a line fit), so a steady song reads as steady; ANALYSIS_VERSION and the device port (web-dsp-1) move together, with the fixtures regenerated.
