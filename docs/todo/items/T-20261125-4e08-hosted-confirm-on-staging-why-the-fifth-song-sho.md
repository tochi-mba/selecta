---
id: T-20261125-4e08
title: Hosted: confirm on staging why the fifth song showed no job of its own
area: storage
status: done
priority: normal
who: either
created: 2026-11-25
source: hosted/jobs, staging run 2026-11-25
commit: 9a1968fa
---

The card counted 5 songs, 2 done and 3 to go, while only two stuck analyse.song jobs were found. Most likely the fifth was a second copy of the same file (copies share one analysis hash and one job, and the job names only the first copy's source_key). Not checked against staging's database. Good: query assets by sha256 for that workspace; if two share a hash this is settled, otherwise look for an admission pause on cpu-heavy at upload time. GET /api/hosted/songs now shows same_file_as and the shared job_id.

2026-11-25: On staging the fifth song is a second copy of 'Call on Me': after the deploy all 5 songs showed as analysed, and the server's mix used both copies (T-20261125-ed08).
