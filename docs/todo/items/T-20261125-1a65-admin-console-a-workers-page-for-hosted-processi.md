---
id: T-20261125-1a65
title: Admin console: a Workers page for hosted processing, with status and guarded controls
area: admin
status: done
priority: high
who: claude
created: 2026-11-25
source: owner, 2026-11-25, while setting up staging workers
commit: 9ead22ca
---

The console says only 'Workers (Modal): Not reporting'. Good: a Workers page that shows each pool (cpu-light, cpu-heavy, export, gpu) with containers running, jobs queued, oldest wait, last heartbeat and recent failures; the gateway's health; spend this month against a budget; and guarded actions (start one worker for a test hour, stop all, retry failed jobs, expire stuck jobs) with the console's usual tiers and confirmations. It must read plainly when nothing is running, and say what a customer sees meanwhile. Follows the console design in docs/saas/07b-admin-console.md. The owner's rule: anything that belongs in the console goes in the console, with finished UI and UX.

2026-11-25: Workers page built (sidebar item, flag admin.workers): pool verdicts from work.queue_health, gateway, autoscaler, storage and flags, customer waits, cost against a budget, guarded actions, stuck-queue alerts, help, tour and checklist item. Start/stop workers stay disabled until the autoscaler reports (Modal token on the maintenance service).
