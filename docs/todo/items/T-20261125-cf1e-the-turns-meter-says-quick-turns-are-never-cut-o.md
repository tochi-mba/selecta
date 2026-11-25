---
id: T-20261125-cf1e
title: The turns meter says quick turns are 'never cut off', but they stop at 1,000 a month
area: lucy
status: open
priority: later
who: either
created: 2026-11-25
source: Found while fixing T-20261125-89f0; web/src/views/LucyCloudSettings.tsx
commit:
---

Premium's quick turns are fair use with a ceiling of 1,000 a month (FAIR_USE_QUICK in src/selecta/ai/allowance.py), and the plan's dollar ceiling usually stops them sooner. The settings page says 'counted, never cut off'. Good: words that are true, for example 'counted, with a high limit that only stops misuse', or no ceiling. The owner may want to choose the words.
