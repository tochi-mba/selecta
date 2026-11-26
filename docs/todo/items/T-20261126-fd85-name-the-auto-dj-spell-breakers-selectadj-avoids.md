---
id: T-20261126-fd85
title: Name the auto-DJ spell-breakers SelectaDJ avoids, after checking each against the planner
area: branding
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

Reviews of Apple Music AutoMix, Spotify AI DJ and djay Automix keep naming the same faults: endings cut off, first verses skipped, clashing pairs, the same songs on repeat, blending over vocals. Promising against them by name is a strong reason to pay, but only where it is true. First check each claim against the planner (src/selecta/planner, mix.settle_chain and its leave_after rule, the vocal sense and FAR_KEYS gates) and write down which ones SelectaDJ really guarantees. Then use only those on the landing page and plan cards.
