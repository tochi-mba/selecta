---
id: T-20261125-ea6b
title: Hosted analysis and transitions have no per-account cap
area: billing
status: done
priority: high
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 3
commit: ef482959
---

What is wrong: the plan's daily analysis allowance (analysis_song: Free 150, Standard 1,500, Premium 5,000) is shown on the Plan and billing meter but nothing takes from it, so the meter always says 0 used and a hosted account can analyse any number of songs a day. Transitions (seam.render, about 0.003 to 0.01 dollars each) have no per-account limit beyond lane concurrency: a client can ask /api/hosted/mixes/render for any order of its songs with any moves, and every new pair is a new job. The platform total is bounded by each pool's daily_spend_ceiling_usd (cpu-heavy 60 dollars) and fair share, and the hosted routes now have their own rate limits, so one account can't spend without limit but can take a pool's day. Fixed in the same change: hosted exports take the plan's monthly exports (hosted_export.allow_export). What good looks like: analysis takes one from analysis_song only for a song's first analysis (never for a re-analysis after our version bump or our failure: key the take on the asset id), with the card saying when today's allowance is used and that the rest start tomorrow; a daily CPU-minute budget per plan for standard-lane transitions like the speculative one. The owner confirms the numbers before it ships.

2026-11-26: hosted/gaps, walkthrough section 11
