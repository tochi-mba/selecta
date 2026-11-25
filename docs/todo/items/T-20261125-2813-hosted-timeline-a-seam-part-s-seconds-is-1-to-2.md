---
id: T-20261125-2813
title: Hosted timeline: a seam part's seconds is 1 to 2 samples longer than its clip file
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

hosted_render._timeline rounds the clip length (cues[2]) to 4 decimals; on 4 of 10 seams in the 12-song mix it is 1 to 2 samples longer than the rendered clip. The player plays the clip's real samples, so nothing is heard, but the timeline's total and every later part's start drift by those samples. Good: the length in whole samples from the clip itself.
