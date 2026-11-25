---
id: T-20261125-2b5e
title: Hosted jobs wait forever when no worker runs
area: infra
status: done
priority: normal
who: either
created: 2026-11-25
source: docs/engineering/hosted-mode-walkthrough.md
commit: 8339751b
---

A queued analyse.song, seam.render or export.render job has no queue time limit: with no worker running it waits forever (seen on staging, where uploads sat as accepted with nothing processing). The hosted card now says it is waiting for a worker when none has checked in for 3 minutes instead of giving an estimate; decide whether queued hosted work should also expire or alert operators after a set time.
