---
id: T-20261125-184c
title: Workers and gateway on different engine versions during a deploy
area: infra
status: open
priority: normal
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 20
commit:
---

What is wrong: producers never set engine_version_required and the claim never filters by it. The worker computes each output's input hash from its own ANALYSIS_VERSION, RENDER_VERSION, PROXY_VERSION and EXPORT_VERSION, while the API declared the output namespace from its versions. During a deploy where the two differ, an old worker's output lands under a hash the job did not declare and the gateway refuses the slot (invalid_output_slots): the job fails, analysis renews up to three times and a transition waits for Try again. Nothing is corrupted (the declared namespace check holds), but customers see failures. What good looks like: one combined engine version in the job (engine_version_required) set by the producers, workers reporting theirs at registration (they already send engine_version), claims skipping jobs for another version, and the deploy runbook saying workers go first. A test drives an old worker against new jobs and sees them wait, not fail.
