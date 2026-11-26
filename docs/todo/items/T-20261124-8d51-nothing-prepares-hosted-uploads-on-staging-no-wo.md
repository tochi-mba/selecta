---
id: T-20261124-8d51
title: Nothing prepares hosted uploads on staging: no workers run
area: infra
status: open
priority: high
who: owner
created: 2026-11-24
source: docs/engineering/staging-walkthrough-notes.md item 14
commit:
---

Staging has no Modal workers, so analysis and server rendering cannot run. Decide whether staging gets workers. The app must say honestly that preparing is waiting.

2026-11-25: the hosted walkthrough (docs/engineering/cloud-library-walkthrough.md, 'Staging and production runbook') lists exactly what a staging worker needs and what it costs. Needs the owner's pick of host and approval of spend.
