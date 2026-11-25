---
id: T-20261125-9dbb
title: Hosted mix planning reads at most 60 songs, in the API
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: docs/engineering/hosted-mode-walkthrough.md
commit:
---

The hosted server mix is planned from at most 60 analysed songs, in the API process (hosted_render.plan_mix). A larger library needs the pool chosen first (or a plan job on a worker).
