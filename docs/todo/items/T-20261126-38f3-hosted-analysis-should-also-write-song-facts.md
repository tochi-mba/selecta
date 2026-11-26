---
id: T-20261126-38f3
title: Hosted analysis should also write song facts
area: storage
status: open
priority: normal
who: claude
created: 2026-11-26
source: Cloud planning, PR #159
commit:
---

engine_store.facts_store.record_worker_analysis(store, artifacts, sha256, analysis_npz) keeps a hosted worker's finished analysis as worker facts of the catalogue song with the same bytes (tested in test_cloud_brain_facts.py). Nothing calls it: the call belongs in src/selecta/hosted_render.py, which was off limits. Good: where the hosted session first finds a finished analysis artifact (_artifact(conn, workspace_id, 'analysis', analysis_hash(song['sha256']))), one line after reading the file: record_worker_analysis(EngineStore(engine, workspace_id), R2ArtifactStore(client, buckets), song['sha256'], path), behind cloud.brain.
