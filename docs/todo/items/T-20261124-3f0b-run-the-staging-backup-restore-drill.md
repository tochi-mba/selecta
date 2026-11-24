---
id: T-20261124-3f0b
title: Run the staging backup restore drill
area: infra
status: open
priority: high
who: owner
created: 2026-11-24
source: docs/engineering/product-audit.md observability, launch-operator-checklist.md section 9
commit:
---

Restore the nightly dump to staging by docs/operations/backup-and-restore.md, replay the deletion ledger, reconcile storage and Stripe, and record the recovery time. It also proves a way back from a bad deploy.
