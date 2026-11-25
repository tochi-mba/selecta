---
id: T-20261125-4fda
title: Re-test the hosted mix on staging after the player rework
area: storage
status: open
priority: now
who: either
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

The staging freeze (T-20261125-6356) was not reproduced as a hang on the dev machine; its ingredients were (whole-file decodes of 160 to 300 MB, a part scheduled 52 times, both mixes playing at once) and are fixed. Play a 2-song and a 12-song hosted mix on staging in Chrome on the owner's laptop with the browser mix also used, and watch Task Manager memory and the page staying responsive. Version 1 playback files are remade as version 2 on the first mix.
