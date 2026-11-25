---
id: T-20261125-ed08
title: Hosted mix plans the same song twice when two copies were uploaded
area: storage
status: open
priority: high
who: claude
created: 2026-11-25
source: staging re-test with Modal workers after PR 149, 2026-11-25
commit:
---

The same song appears twice in the server's mix when a customer has uploaded two copies of one file ('Call on Me' at positions 1 and 4 on staging). Copies share one analysis (same_file_as), so the planner can tell. Good: one copy per song in a planned mix, and the Library says plainly that two uploads are the same recording (see the duplicate songs work, ADR-0469 amendment 2).
