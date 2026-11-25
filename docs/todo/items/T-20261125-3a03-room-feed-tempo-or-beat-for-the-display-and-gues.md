---
id: T-20261125-3a03
title: Room feed tempo or beat for the display and guest playing marks
area: rooms
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

The playing marks on the TV display (display.css .d-eq) and the guest page (guest.css .g-eq) stand still at three heights because the room feed carries no tempo or beat, and ADR-0477 rule 4 lets only measured music move. If the host's speaker could publish the playing song's analysed tempo and the session clock's beat phase in the room feed, both pages could pulse the bars on real beats (capped at three a second, off under reduced motion). Needs a server field first; until then the still mark is correct.
