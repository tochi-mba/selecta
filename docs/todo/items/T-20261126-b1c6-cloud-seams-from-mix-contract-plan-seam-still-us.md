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
