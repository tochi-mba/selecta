---
id: T-20261125-a147
title: Hosted card: words for the new estimate and export progress fields
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: hosted export work, walkthrough section 9
commit: fbd98d09
---

mixes/render now answers estimate_why (null, no_worker, overrunning, busy) and work (queued, running, slots); exports/{id} answers parts_done, parts_total, worker_seen and estimate_s only from the job's own pace; songs answer same_recording_as. The card (web/src/cloud/hosted/HostedMix.tsx) shows 'waiting for a worker' whenever estimate_s is null, which is wrong for overrunning and busy. Good: 'Taking longer than usual: 2 of 4 transitions ready' for overrunning, 'The servers are busy with other mixes' for busy, 'Exporting: part 3 of 9' from parts_done, and the Library naming copies of one recording.
