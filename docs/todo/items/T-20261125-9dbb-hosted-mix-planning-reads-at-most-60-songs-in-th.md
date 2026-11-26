---
id: T-20261125-9dbb
title: Hosted mix planning reads at most 60 songs, in the API
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/hosted-mode-walkthrough.md
commit: c6593fe3
---

The hosted server mix is planned from at most 60 analysed songs, in the API process (hosted_render.plan_mix). A larger library needs the pool chosen first (or a plan job on a worker).

2026-11-25: A library over 60 recordings is now sampled at random for each plan (hosted_render.planning_pool) and the card says so; the plan route has its own rate limit (hosted_plan, 10 a minute). Planning still runs in the API process for at most 60 songs.
