---
id: T-20261125-3562
title: The account export leaves out crowd marks and room recaps
area: rooms
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0488 RS-0488-12, 2026-11-25
commit:
---

crowd_marks and room_recaps hold no guest data and stay with the host's workspace, so they belong in the account export and in workspace and song deletion. Neither is wired yet. Add both tables to the export and to the deletion paths, with a test.
