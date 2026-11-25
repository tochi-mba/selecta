---
id: T-20261125-7e14
title: Derived files of failed and superseded attempts are never deleted
area: storage
status: open
priority: high
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 2
commit:
---

What is wrong: workers write every output under w/<workspace>/<kind>/<hash>/attempts/<attempt>/ before completing. When an attempt fails, loses its lease, or a later attempt republishes the same inputs, the artifact row names only the winning keys; nothing ever deletes the others (work/artifacts.py and storage/eviction.py both say a garbage collector finds them, and none exists). Eviction and export expiry also delete rows before objects, so a crash between leaves objects with no row. They cost R2 storage for ever and only go with account deletion. What good looks like: a maintenance task (own flag, dry run first, counts on the Workers page) that lists each workspace's derived prefix and deletes an object when no artifact row names its key, no live attempt (job_attempts.outcome IS NULL) has its attempt id, and it is older than twice the longest job runtime limit (6 hours is safe). Also measure the derived budget against hosted playback files: at about 40 MB a song, a 1,000-song library is 40 GB of playback files against a budget of 15 % of plan storage, so eviction will churn and remake playback files for every mix; set the budget per plan from real numbers.
