---
id: T-20261126-14ff
title: Port the drum pattern and swing arrays to the browser analysis
area: devices
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/engineering/device-analysis.md, rhythm_bars
commit:
---

`features.rhythm_bars` (Python) adds `pattern_bars` and `swing_bars`; the recipe is in
docs/engineering/device-analysis.md ("Drum pattern and swing"). Port it in web/src/dsp/analysis,
send the pair with the facts (the Cloud accepts it as optional), make
tools/device_analysis_golden.py emit `patternBars` and `swingBars`, regenerate the fixtures and
check the port against them. Until then device-measured songs get no rhythm opinion.

