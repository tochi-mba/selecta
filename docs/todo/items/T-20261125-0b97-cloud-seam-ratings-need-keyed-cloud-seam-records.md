---
id: T-20261125-0b97
title: Cloud seam ratings need keyed Cloud seam records
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain programme, Phase 3 engine store groundwork (PR #150)
commit:
---

POST /api/seams/{key}/rate and GET /api/memory/ratings are not mounted in Cloud. On Desktop both read and write the seam's record files (seam.json, seam-history), not the ratings table, and Cloud has no place where a seam has a key and a ready state. Good looks like: the seams slice gives Cloud seams keyed, workspace-scoped records in the engine store; then both routes mount for Cloud accounts through EngineStore with the caller's workspace, with a flag owner and rows in the tenant isolation matrix.
