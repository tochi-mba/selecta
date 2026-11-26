---
id: T-20261126-242a
title: Business HQ's list rows are taller than their content
area: rooms
status: open
priority: later
who: claude
created: 2026-11-26
source: polish pass report, PR #170 (layout sweep)
commit:
---

Business HQ's virtual list estimates each row's height too tall, so rows stay taller than their content at every width. Good: the estimate matches the drawn row, or the list measures rows, so there is no extra space between them.
