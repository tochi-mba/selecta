---
id: T-20261126-24f1
title: Hosted seams should also be kept in the seam tables
area: storage
status: done
priority: normal
who: claude
created: 2026-11-26
source: Seams slice, Phase 7 step 1
commit: b206e59e
---

engine_store.hosted_seams.record_worker_seam(store, a_sha256=, b_sha256=, digest=, move=, cues=, clip_sha256=, worker_id=, implementation=, passed=) keeps a cloud studio's finished seam as the workspace's seam with provenance worker (tested in tests/test_cloud_brain_seams.py). Nothing calls it: the call belongs in src/selecta/hosted_render.py, which was off limits. Good: where the hosted session finds a seam artifact ready (row = _artifact(conn, workspace_id, 'seam', digest) with cues from _cues(row)), one call after reading it, behind cloud.brain: record_worker_seam(EngineStore(engine, workspace_id), a_sha256=a['sha256'], b_sha256=b['sha256'], digest=digest, move=move, cues={'a_source_start': c[0], 'b_source_end': c[1], 'seconds': c[2]}, clip_sha256=<the artifact's content hash>, worker_id=<the job's worker>, implementation=f'python-render-{RENDER_VERSION}', passed=<the worker's audit verdict>). The worker's audit verdict must be added to the artifact's provenance if it isn't there.

2026-11-26: hosted_brain.keep_seams, called from hosted_render.mix_state behind cloud.brain for every rendered hosted seam (either path), once, with the attempt's worker id and the audit verdict already in the artifact provenance. tests/test_hosted_brain.py.
