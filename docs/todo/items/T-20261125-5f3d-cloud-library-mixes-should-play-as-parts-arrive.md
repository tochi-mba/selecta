---
id: T-20261125-5f3d
title: Cloud-library mixes should play as parts arrive and keep a rating memory
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0479 and the owner's plan approval, 2026-11-25
commit:
---

The hosted card enables Play only when every part is ready, and the server starts each seam with no ratings and no count of moves already used (docs/engineering/cloud-library-walkthrough.md, section 4). Good looks like: play starts when the first transition is ready, and the server uses seam memory and move variety as Desktop does. ADR-0479 phase 6.
