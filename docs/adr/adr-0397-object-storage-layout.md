# ADR-0397 - Object storage layout and artifact provenance on R2

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/5 Implemented; 0/5 In progress; 1/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0394; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/stems.py`; `src/selecta/seams.py`; `src/selecta/seam_kinds.py`; `src/selecta/analysis/pipeline.py`; new `src/selecta/storage/`.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md#51-buckets-and-keys-cloudflare-r2-eu-jurisdiction).

## Context and evidence boundary

Today every artifact lives under `SELECTA_HOME`, seam keys use local song ids and stem keys use file path and mtime. Cloud artifacts need content-based keys, provenance and safe concurrent writes.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Cloudflare R2 (EU jurisdiction) with four private buckets: originals, derived, exports, staging, each with its lifecycle.
- Object keys never contain user text; outputs are written under attempt prefixes and exposed through a manifest row.
- Artifacts are keyed by a hash of their inputs (asset content hashes, analysis and render versions, model checkpoints, settings) and record provenance.
- Derived data is evictable under per-workspace budgets, protected while referenced by a playing or frozen revision.
- No cross-account deduplication.

## User outcome and acceptance contract

Identical requests reuse finished work instantly; engine upgrades never invalidate exported mixes; one user's files never reveal another's.

## Rejected alternatives

- S3 (egress fees for audio).
- Cross-account dedupe (existence side channel, deletion and copyright complexity).

## Implementation checklist - 1/5 Implemented; 0/5 independently Verified

1. **SC-0397-01 - ArtifactStore interface.** **Acceptance:** Local and R2 implementations behind one interface used by workers. **Required verification:** Unit and integration tests. **Implementation:** Implemented. **Evidence:** `src/selecta/storage/artifacts.py`; `src/selecta/workers/context.py`; `tests/test_cloud_worker_artifacts.py` (local and R2 unit tests plus real runner integration). **Independently Verified:** No.
2. **SC-0397-02 - Content-addressed keys.** **Acceptance:** Seam and stem keys derive from content hashes scoped to the workspace. **Required verification:** Unit tests. **Implementation:** Implemented; seam, stem and derived keys come from `input_hash` over content hashes, scoped to the workspace prefix. **Evidence:** `tests/test_cloud_storage_keys.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0397-03 - Provenance.** **Acceptance:** Every artifact row records inputs, versions and checksum. **Required verification:** Schema test. **Implementation:** Implemented; every artifact row has a SHA-256 `checksum` and a `provenance` naming its inputs (asset hashes or keys), versions (playback must name `proxy`, seams `analysis` and `render`), models where they apply and the settings hash, by one rule in `src/selecta/work/provenance.py` enforced at publish, upload, the collecting sink, `complete` (refused as `engine_bug`, nothing written) and invariant 5; both columns are NOT NULL (migration `a3f8d2c61b97`). **Evidence:** `tests/test_cloud_artifact_provenance.py` (schema test `test_checksum_and_provenance_are_not_null_in_the_database`, the validator cases and the migration round trip), plus the publish, gateway, remote-runner and invariant tests, passing on SQLite and PostgreSQL. **Independently Verified:** No.
4. **SC-0397-04 - Eviction with protection.** **Acceptance:** Budgets evict least-recent unprotected artifacts only. **Required verification:** Integration test. **Implementation:** Implemented; derived artifacts over the workspace's budget go least recently used first, never protected or playing ones and never across workspaces. **Evidence:** `tests/test_cloud_storage_eviction.py` (7 tests), passing on SQLite and PostgreSQL. **Independently Verified:** No.
5. **SC-0397-05 - Bucket lifecycle.** **Acceptance:** Staging multipart aborts after 1 day; exports expire per plan. **Required verification:** IaC review plus staging check. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
