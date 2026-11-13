# ADR-0392 - Two runtime modes, one codebase

> **Architecture supersession (2026-11-13):** Historical implementation and acceptance statuses below remain recorded, but any conflicting hosted-user-audio design is superseded for future work by LF ADR-0456. See [LF preservation map](selecta-local-first-overlap-and-parity.md). The replacement is accepted as a design, **not implemented**.

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 5/5 Implemented; 0/5 In progress; 0/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0390 (feature flags); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/api_common.py`; `src/selecta/config.py`; `src/selecta/cli.py`; new `src/selecta/modes/`.
- **Proposal chapter:** [docs/saas/03-architecture.md](../saas/03-architecture.md#41-runtime-modes-one-codebase).

## Context and evidence boundary

One codebase must serve a single-user Windows app and a multi-tenant cloud service. Today the app factory starts background threads, a seam-worker subprocess, a folder watcher and local-only middleware unconditionally.

The Cloud API factory and `SELECTA_MODE` dispatch are present; the web app now selects local or Cloud UI from `/api/status`. Local/cloud startup mode selection has a focused test. Full mode parity, worker placement and production persistence remain incomplete.

## Decision

- `SELECTA_MODE=local|cloud` selects adapters at app start: database, artifact storage, identity, job runner placement, Lucy routing and network posture.
- Domain logic (analysis, planner, render, seams, mix, Lucy tools) is shared and mode-agnostic.
- Local mode keeps the current middleware (`local_only`) and threads; cloud mode starts none of them and adds auth, CORS allowlist, trusted hosts and rate limits.
- Features unavailable in a mode are expressed through the flag registry's new `modes` field (ADR-0414), not scattered `if` statements.

## User outcome and acceptance contract

The same commit builds the local app and the cloud services; a mode can never accidentally run the other's startup side effects.

## Rejected alternatives

- Forking a separate cloud repository (duplicate engine, drift).
- Making cloud the only mode.

## Implementation checklist - 5/5 Implemented; 0/5 In progress; 0/5 Not started; 0/5 independently Verified

1. **SC-0392-01 - Mode switch.** **Acceptance:** App factory selects adapters from `SELECTA_MODE`; default `local`. **Required verification:** Unit tests for both modes. **Implementation:** Implemented; `serve()` defaults to local and selects the Cloud API factory in Cloud mode. **Evidence:** `tests/test_cloud_api.py::test_serve_defaults_to_local_and_cloud_does_not_start_local_workers`. **Independently Verified:** No.
2. **SC-0392-02 - No local side effects in cloud.** **Acceptance:** Cloud mode starts no watcher, warm-up or worker threads and never calls `forget_unfinished()`. **Required verification:** Integration test asserts no threads/subprocesses at start. **Implementation:** Implemented; building the app through `api.serve()` with `SELECTA_MODE=cloud` and running its whole lifespan starts no watcher, warm-up, seam worker, restore, `forget_unfinished()`, subprocess or Selecta thread. **Evidence:** `tests/test_cloud_startup_side_effects.py` (4 tests), passing. **Independently Verified:** No.
3. **SC-0392-03 - Local parity.** **Acceptance:** All existing Python and Playwright tests pass in local mode. **Required verification:** CI. **Implementation:** Implemented; the python and browser CI jobs run the full local suites, and they are green on current main: the SQLite mixed-load race that failed main run 42804446112 now passes. **Evidence:** `.github/workflows/test.yml` jobs python and browser; CI run 42891954111 (2026-11-10, pull_request run of current main merged with a web dependency bump: Python / tests shards 1/2 and 2/2, Edge E2E shards 1/2 and 2/2, Cloud / PostgreSQL shards 1-3, Cloud E2E and verify all success). **Independently Verified:** No.
4. **SC-0392-04 - Copy layer.** **Acceptance:** User-facing strings that mention 'this PC' come from a mode-keyed copy layer. **Required verification:** Vitest snapshot per mode. **Implementation:** Implemented; local and Cloud words come from the mode-keyed `web/src/copy.ts`; what remains elsewhere mentioning this PC or File Explorer is code comments only. **Evidence:** `web/src/copy.test.ts` with per-mode snapshots in `web/src/__snapshots__/copy.test.ts.snap`, passing on Node 22 and 24. **Independently Verified:** No.
5. **SC-0392-05 - Linux CI for cloud mode.** **Acceptance:** A Linux job runs the cloud-mode test set. **Required verification:** CI. **Implementation:** Implemented; the Linux `Cloud / PostgreSQL` CI job runs the cloud test set on SQLite and PostgreSQL 16 with branch coverage and the coverage gate. **Evidence:** `.github/workflows/test.yml` job `cloud`; CI run 42748170607 (Cloud / PostgreSQL: success). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
