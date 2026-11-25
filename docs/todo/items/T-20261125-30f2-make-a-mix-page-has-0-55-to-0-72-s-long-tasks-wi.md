---
id: T-20261125-30f2
title: Make a Mix page has 0.55 to 0.72 s long tasks with nothing playing on a slow CPU
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

With Chrome's CPU 4x slowdown and no playback, the Make a Mix page of a hosted account had a main-thread task of 0.55 to 0.72 s every few seconds (dev build, Playwright long-task observer). Profile the production build on a phone-class CPU and find what runs.
