---
id: T-20261125-92ba
title: work.sqlite in backups
area: storage
status: dropped
priority: normal
who: claude
created: 2026-11-25
source: One brain programme, Phase 3 engine store groundwork (PR #150)
commit:
---

backup.py ships only selecta.sqlite; work.sqlite (the durable job store, core.durable_local_jobs) is never backed up or restored. Left out on purpose for now: it holds jobs and leases, not the library, and restoring an old copy would bring back finished or fenced work. Good looks like: when the seams slice moves Desktop's audio jobs onto it, decide which of its rows are worth keeping (results, not leases), back those up with the library, and prove the round trip.

2026-11-26: Decided with the seams slice (commit f0e0e530): a seam's lasting state is its record, in its files and, with core.engine_store on, the library's seam tables, which every backup carries. work.sqlite holds only jobs, leases and their order; restoring an old one would bring back finished or fenced work, and a lost job is simply asked for again. Nothing in it is worth keeping across a restore.
