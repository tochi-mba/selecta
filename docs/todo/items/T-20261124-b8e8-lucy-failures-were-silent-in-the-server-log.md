---
id: T-20261124-b8e8
title: Lucy failures were silent in the server log
area: lucy
status: done
priority: high
who: claude
created: 2026-11-24
source: docs/engineering/staging-walkthrough-notes.md item 17
commit: a6307d71
---

Log one line per provider failure, raise an alert for configuration errors, add a readiness self-check, step down on errors. Pushed by the Lucy agent. Confirm on staging after the next deploy.
