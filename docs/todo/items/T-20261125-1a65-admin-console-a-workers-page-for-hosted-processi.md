---
id: T-20261125-1a65
title: Admin console: a Workers page for hosted processing, with status and guarded controls
area: admin
status: open
priority: high
who: claude
created: 2026-11-25
source: owner, 2026-11-25, while setting up staging workers
commit:
---

The console says only 'Workers (Modal): Not reporting'. Good: a Workers page that shows each pool (cpu-light, cpu-heavy, export, gpu) with containers running, jobs queued, oldest wait, last heartbeat and recent failures; the gateway's health; spend this month against a budget; and guarded actions (start one worker for a test hour, stop all, retry failed jobs, expire stuck jobs) with the console's usual tiers and confirmations. It must read plainly when nothing is running, and say what a customer sees meanwhile. Follows the console design in docs/saas/07b-admin-console.md. The owner's rule: anything that belongs in the console goes in the console, with finished UI and UX.
