---
id: T-20261126-aa2d
title: End the first listen on its best moment with a short recap
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

People judge an experience mostly by its peak and its end (peak-end rule; Alaybek et al. 2022 meta-analysis, r=0.58). The first mix should start near its strongest seam, and the first listening session should end with a short recap: the best blend, lyric links found, how many songs flowed, not a paywall. web/src/rooms/RoomRecap.tsx already does this for rooms and is the pattern to reuse. Only true numbers. Needs a flag.
