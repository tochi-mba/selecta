---
id: T-20261126-82ae
title: The layout sweep never draws a hand-off mid-transition
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: polish pass report, PR #170 (layout sweep)
commit:
---

The desktop layout sweep never reaches a hand-off in the middle of a transition: the seam's first render took longer than the wait, even at 280 seconds, so it measured the pending and last-track cards instead. Good: the sweep seeds or stubs a ready seam so the mid-transition hand-off is drawn and measured at every width, without a long wait.
