---
id: T-20261124-8d51
title: Nothing prepares hosted uploads on staging: no workers run
area: infra
status: open
priority: high
who: either
created: 2026-11-24
source: docs/engineering/staging-walkthrough-notes.md item 14
commit:
---

Staging has no Modal workers, so analysis and server rendering cannot run. Decide whether staging gets workers. The app must say honestly that preparing is waiting.
