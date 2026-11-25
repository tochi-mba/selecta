---
id: T-20261125-4742
title: Bind flag answers for Cloud fleet jobs
area: infra
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain programme, Phase 3 engine store groundwork (PR #150)
commit:
---

WorkerRunner binds a job's workspace flag answers only when its store can decide them (JobStore with CloudJobFlags, as in the devstack worker). Fleet workers reach the store through the worker gateway, which sends no flag answers, so their handlers read process flags. Good looks like: the gateway includes the workspace's decided flags with a claim and the gateway client exposes flag_answers, with a test that a handler sees them.
