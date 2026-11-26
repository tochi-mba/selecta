---
id: T-20261126-135f
title: The guest sites sweep and the guest test both host as alice
area: ci
status: open
priority: later
who: claude
created: 2026-11-26
source: polish pass report, PR #170 (layout sweep)
commit:
---

web/e2e-cloud/layout-sweep-sites.cloud.ts and the main guest test both host as the member alice, so they collide when run with more than one worker (one failed run). CI runs one worker, so CI passes. Good: the sweep uses its own member from e2e-cloud/sweepMembers.ts, so the specs can run in parallel.
