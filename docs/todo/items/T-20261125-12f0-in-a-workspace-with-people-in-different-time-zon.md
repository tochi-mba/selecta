---
id: T-20261125-12f0
title: In a workspace with people in different time zones, Lucy's month differs by person at a month end
area: lucy
status: open
priority: later
who: claude
created: 2026-11-25
source: Found while fixing T-20261125-89f0
commit:
---

The gateway counts a turn in the month of the person who sent it (their time zone) and the meter reads the month of the person looking. For a few hours around a month end two members of one workspace can be in different months, so one sees turns the other does not. One-person workspaces are unaffected. Good: one time zone per workspace for Lucy's month (the owner's, or the organisation's), used by admission and the meter alike.
