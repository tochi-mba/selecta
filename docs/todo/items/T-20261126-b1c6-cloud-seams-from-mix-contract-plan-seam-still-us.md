---
id: T-20261126-b1c6
title: Cloud seams from mix_contract.plan_seam still use tempo and key alone
area: library
status: open
priority: normal
who: claude
created: 2026-11-26
source: Cloud planning, PR #159
commit:
---

mix_contract.plan_seams (plan_seam per pair) is called inside mix_contract when a contract is built: from cloud_mixes.py (POST /api/cloud-mixes and its revisions) and local_media/recipes.py (portable recipes). The kiosk and the hosted renderer play the seams those contracts carry. ADR-0479 wants the planner core instead. Good: behind cloud.brain, a contract over catalogue songs with facts takes each seam from cloud_brain.planning.candidates (the top option and its script); songs without facts keep plan_seam; the kiosk's and hosted renderer's reading of the contract checked unchanged.

Checked 2026-11-26 (Phase 6): neither the hosted renderer nor the kiosk calls plan_seam or reads a contract's seams. The hosted mix is ordered by planner.beam.plan_set and each seam chosen on the worker by workers.engine_seams (the Desktop seam store's fallback order), or with cloud.hosted_brain by the planner core (hosted_brain, workers.engine_core); kiosk horizon seams are seam.render jobs with style None and keep engine_seams. What is left here is only the contracts' own seams: /cloud-mixes revisions and recipes, which no renderer plays (the browser plans its own seams as it plays).
