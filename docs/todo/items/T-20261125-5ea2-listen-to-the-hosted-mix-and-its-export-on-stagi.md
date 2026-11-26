---
id: T-20261125-5ea2
title: Listen to the hosted mix and its export on staging, on a computer and a phone
area: storage
status: open
priority: normal
who: owner
created: 2026-11-25
source: staging re-test with Modal workers after PR 152, 2026-11-25
commit:
---

Everything checkable by machine passed on staging: plan, render, play, jump, export, download. What only a person can judge is still open: listen to the hosted mix and the exported file end to end on staging (the transitions, the levels at each join, no clicks), on a computer and on a phone, and compare with the same songs in the local app. Sign in as the hosted test account, open Make a Mix, press Play, then Download the mix. Workers must be started first (ask Claude, or use the console's Workers page once the autoscaler has its Modal token).
