---
id: T-20261125-7aac
title: Hosted mix estimate ignores other accounts' jobs on the shared pool
area: storage
status: open
priority: later
who: claude
created: 2026-11-25
source: hosted_estimate.py, walkthrough section 9
commit:
---

hosted_estimate.mix_estimate lays only this workspace's jobs onto the pool's slots: the workspace-scoped transaction cannot count other accounts' queued jobs. When the pool is busy with other work it says nothing (estimate_why busy) rather than a time. Good: a pool-wide queue depth from a staff-scoped read (work.queue_health already has one) folded into the estimate.
