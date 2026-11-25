---
id: T-20261125-3d32
title: Concurrent seam claimers test failed once on CI; passes 20 of 20 locally
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: PR #137 CI at 9370e65f, Python shard 1
commit:
---

tests/test_local_durable_seams.py::test_concurrent_claimers_never_render_one_seam_twice failed once on CI (the three claimers' rendered lists did not add up to the 24 seams once each). Nothing in seams, jobs, work or scheduling changed since its last pass, and it passed 20 runs in a row locally (2026-11-25). Each thread joins with a 60 s limit, so a slow runner may leave a worker unfinished rather than render twice; read the CI assertion diff next time: a missing key means the join timed out, a doubled key is a real race in the local seam worker.
