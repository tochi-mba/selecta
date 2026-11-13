# ADR-0405 - Licence register and replacing S-KEY for commercial use

> **Architecture supersession (2026-11-13):** Historical implementation and acceptance statuses below remain recorded, but any conflicting hosted-user-audio design is superseded for future work by LF ADR-0475. See [LF preservation map](selecta-local-first-overlap-and-parity.md). The replacement is accepted as a design, **not implemented**.

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/4 Implemented; 2/4 In progress; 1/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 0. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** None; their statuses are unchanged.
- **Source touchpoints:** `src/selecta/analysis/key.py`; `src/selecta/analysis/skey_model.py`; `src/selecta/stems.py`; `src/selecta/lyrics/align.py`; `docs/saas/licence-register.md`.
- **Proposal chapter:** [docs/saas/licence-register.md](../saas/licence-register.md).

## Context and evidence boundary

The key-detection model S-KEY is licensed for non-commercial research only (`analysis/skey_model.py:5-6`). Other weights have unstated or research-data licences. A paid service needs every model cleared.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- `docs/saas/licence-register.md` lists every model, dependency, system tool and data source with its licence and cloud-mode status.
- S-KEY is blocked in cloud mode and must be replaced before any paid plan: candidates are a self-trained key classifier on rights-cleared data, a tuned classical chroma/profile method (no weights), or a commercial licence from Deezer.
- Replacement accuracy is benchmarked against S-KEY on the owner's library and confirmed by listening.
- Cloud workers load models only from an allowlist generated from the register.

## User outcome and acceptance contract

Selecta Cloud never ships a model it isn't allowed to use commercially, and mixes don't get worse because of the change.

## Rejected alternatives

- Launching with S-KEY and fixing it later.
- Essentia or madmom models (AGPL or non-commercial).

## Implementation checklist - 1/4 Implemented; 0/4 independently Verified

1. **SC-0405-01 - Register complete.** **Acceptance:** Every model and dependency in the worker images has a row. **Required verification:** Doc review against image contents. **Implementation:** In progress; the machine-readable register `src/selecta/modes/licence_register.json` has a row per package in the runtime closure of `uv.lock` plus the `observability` extra (99 packages) and per system tool (ffmpeg, libsndfile1); `src/selecta/audit/licence_register.py --write` keeps it in step; the worker image (`infra/modal/selecta_workers.py`) and service image (`infra/docker/service.Dockerfile`) install exactly that closure; every weights loader calls `require_model` and every model id it names is in the allowlist; 9 rows (8 packages, ffmpeg) still say Review. Needs a person: compare the register against a built worker image (`pip list`, `ffmpeg -buildconf`) and record the GPU image's CUDA build. Needs staging: a built image to compare. **Evidence:** `tests/test_cloud_licence_register.py` (31 passed together with `tests/test_cloud_model_allowlist.py` and `tests/test_cloud_deploy_workflow.py` on 2026-11-10). **Independently Verified:** No.
2. **SC-0405-02 - S-KEY replacement.** **Acceptance:** Chosen replacement meets the agreed accuracy threshold against S-KEY. **Required verification:** Benchmark report plus listening check. **Implementation:** In progress; the benchmark harness exists: `selecta key-benchmark` (flag `tools.key_benchmark`, `src/selecta/analysis/key_benchmark.py`) opens the library read-only, runs a candidate key method (the chroma template match in `analysis/key.py` today) on every analysed song with a stored S-KEY key, skips songs where chroma stood in for S-KEY or the file is gone, and writes a JSON report: exact, mixable and MIREX-weighted agreement with S-KEY, the same scores for both methods against the owner's own key corrections, and the disagreements; `--threshold` says whether the candidate reaches it. Needs a person: the owner to agree the accuracy threshold, run the benchmark on their library, choose a replacement (self-trained classifier, the chroma match, or a Deezer licence) and do a listening check. Evidence: `tests/test_key_benchmark.py` (13 passed on 2026-11-12). **Independently Verified:** No.
3. **SC-0405-03 - Model allowlist.** **Acceptance:** Cloud mode refuses to load an unlisted model. **Required verification:** Unit test. **Implementation:** Implemented. **Evidence:** `src/selecta/modes/models.py`; `src/selecta/modes/model_allowlist.json`; `tests/test_cloud_model_allowlist.py`. **Independently Verified:** No.
4. **SC-0405-04 - Legal review.** **Acceptance:** Rows marked Review are resolved by a lawyer before paid launch. **Required verification:** Written advice on file. **Implementation:** Not started; Needs a person: a lawyer's written advice on every Review row in `docs/saas/licence-register.md` and `src/selecta/modes/licence_register.json` (Demucs weights, ffmpeg build, sphn, httpx2-jsfetch), filed before paid launch. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
