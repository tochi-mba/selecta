---
id: T-20261125-fb1d
title: Kiosk playing dots never animate: the rule sets a delay but names no animation
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit: 0c9cd1c5
---

web/src/kiosk/kiosk.css lines 28 to 33 give .k-motif span an animation-delay with no animation, so the playing motif is static. Good: the dots show playing in a way that is true to the room (ADR-0477 rule 4), or stay a plain mark.
