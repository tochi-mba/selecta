---
id: T-20261125-4c09
title: Long tracks against hosted job limits and export size
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 12
commit: ef482959
---

What is wrong: Premium accepts 2-hour uploads (Standard 1 hour). Job runtime limits are fixed: analyse.song 1,200 s, play.proxy 180 s, seam.render 600 s, export.render 1,800 s. Analysis ran at 0.17 to 0.5 times the song's length quietly (1.7 times under load), so a one-hour track can pass 1,200 s; a 2-hour decode holds about 2.5 GB of float samples on an 8 GB worker; a one-hour playback file is about 700 MB and its encode may pass 180 s on cpu-light. A mix of long tracks exports several GB (11.7 MB a minute) with no limit on total length. What good looks like: each job's max_run_s and est_cost_s set from the song's duration (the catalogue's figure as a floor), analysis of long files windowed, an export length limit said plainly on the card (for example 4 hours), and one real-worker run with a 60-minute track. Short clips are handled: a song with no exit cue is left out of planning (hosted_render.plan_mix) and an export needs two songs.

2026-11-26: hosted/gaps, walkthrough section 11
