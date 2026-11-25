---
id: T-20261125-e9b6
title: Motion inventory still lists a Menu, Tooltip and Popover exit gap the code has closed
area: docs
status: done
priority: normal
who: claude
created: 2026-11-25
source: Feel analysis, 2026-11-25 (ADR-0477, ADR-0478)
commit: a238aee7
---

docs/engineering/motion-inventory.md Known gap says usePresence is given --motion-fast; the code now calls usePresence(open) with the default --motion-exit-menu. Good: the section is corrected or removed when the inventory is rewritten for ADR-0477.
