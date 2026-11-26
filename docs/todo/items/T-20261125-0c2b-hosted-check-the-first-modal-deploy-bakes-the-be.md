---
id: T-20261125-0c2b
title: Hosted: check the first Modal deploy bakes the beat model
area: infra
status: done
priority: normal
who: owner
created: 2026-11-25
source: hosted/jobs, infra/modal/selecta_workers.py
commit: 14d6dd48
---

The Modal image now runs model_lock fetch at build time and verifies the checkpoint when each function starts. It could not be deployed from here. Good: the next modal deploy's build log shows the fetch of beat_this.small0 with its hash checked, and a new container's first analysis logs no 'Downloading https://cloud.cp.jku.at' line.

2026-11-25: The Modal image built twice from main with the beat model baked in (deploys on 2026-11-25), and analysis ran on those workers.
