---
id: T-20261125-f6c6
title: TV display and guest page playing bars run on a timer, not on the music
area: rooms
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit:
---

web/src/display/display.css (d-eq) and web/src/guest/guest.css (g-eq) loop bars while music plays without any audio or tempo behind them. ADR-0477 rule 4: nothing musical runs on a timer. Good: bars tick on the real tempo if the room feed carries it, otherwise a plain playing mark.
