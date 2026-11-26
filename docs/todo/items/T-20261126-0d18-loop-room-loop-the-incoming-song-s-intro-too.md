---
id: T-20261126-0d18
title: Loop room: loop the incoming song's intro too
area: local-app
status: open
priority: normal
who: claude
created: 2026-11-26
source: Transition craft II (One brain phase 8), feat/one-brain-5
commit:
---

move.loop_room only loops the outgoing song's last clean bars (planner_core/recipes/loop.py). A DJ also loops the first clean bars of the incoming song when it has no intro to blend over. Good: a second Room shape where B's first clean 4 or 8 bars repeat under A's ending, with B's later bars entering on a phrase line after the loop; same rules (whole bars, no singing, one section, at most 4 passes, first pass B's own audio is the LAST pass so B carries on naturally into native playback), same flag, audited on a synthetic pair before it is offered.
