---
id: T-20261126-c1b6
title: In the layout sweep, Open the Studio does not open the Studio
area: editor
status: open
priority: normal
who: claude
created: 2026-11-26
source: polish pass report, PR #170 (layout sweep)
commit:
---

In the desktop layout sweep (web/e2e/layout-sweep-states.e2e.ts), clicking "Open the Studio" did not open the Studio, so only the Seam Inspector's Studio tab was measured for sideways scroll. Find out whether the button is broken for members or the sweep clicks it before it is ready. Good: the sweep opens the full Studio at every width and it keeps to the window.
