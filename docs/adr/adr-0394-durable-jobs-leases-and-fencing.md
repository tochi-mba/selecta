# ADR-0394 - Durable jobs with leases and fencing

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 4/6 Implemented; 2/6 In progress; 0/6 Not started.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0076 (incremental migration and rollback); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/seams.py`; `src/selecta/seam_worker.py`; `src/selecta/jobs.py`; `src/selecta/eta.py`; `src/selecta/api_common.py`; `src/selecta/routes/exports.py`; `src/selecta/recovery.py`; new `src/selecta/jobs/`, `src/selecta/workers/`.
- **Proposal chapter:** [docs/saas/04-queue-and-scheduling.md](../saas/04-queue-and-scheduling.md#4a3-lifecycle).

## Context and evidence boundary

Background work is coordinated through a stdin pipe to one seam-worker subprocess, in-memory deques, `seam.json` status files, a `rendering-mix` sign file, an analysis subprocess and JSON export-job files tracked in a process dict. None of it survives multiple instances or remote workers, and some of it corrupts state when a second instance starts.

The shared schema, fenced job store, retry/reaper lifecycle, transactional outbox and cooperative handler runner are implemented in code. Local audio handlers have not been migrated, PostgreSQL race behavior is not verified, and the required Hypothesis/chaos evidence remains outstanding.

## Decision

- One durable job model (`jobs`, `job_dependencies`, `job_attempts`, `artifacts`) with the lifecycle in the proposal, changed only through one state module inside transactions, with an outbox event per transition.
- At-least-once execution with exactly-once publication: each attempt holds a renewable lease with a fencing token, writes outputs under its own attempt prefix, and only the current lease holder can publish.
- Lease expiry is reaped by a single maintenance leader using database time only; the leader holds a session advisory lock on a direct connection, and every maintenance task is idempotent and fenced by the leader's term number.
- Workers never write to the database: job results travel in `complete` and are applied in the same fenced transaction; `complete` is idempotent per attempt; heartbeats touch only the attempt row; each job type has a maximum run time enforced by a worker watchdog and by the reaper.
- A partial unique index on non-terminal jobs prevents duplicate work; outbox events are written with `pg_notify` in the same transaction and read by id, so delivery is at-least-once with dedupe.
- Error classes (transient, resource, input invalid, dependency, poison, engine bug) decide retries; poison jobs are quarantined.
- The local app adopts this first, with an in-process runner on SQLite, replacing the pipe, the analysis subprocess and JSON export jobs.

## User outcome and acceptance contract

Work survives restarts, crashes and deploys; a stale worker can never overwrite a newer result; status shown to users comes from the database, not files.

## Rejected alternatives

- Celery/Redis as the source of truth (weak durability, no fencing).
- Keeping file-based status alongside the database (two truths).

## Implementation checklist - 0/6 Implemented; 0/6 independently Verified

1. **SC-0394-01 - Job tables and state module.** **Acceptance:** All transitions go through one module; illegal transitions raise. **Required verification:** Hypothesis state-machine tests. **Implementation:** Implemented; every transition goes through `work/state.py` and `work/lifecycle.py`; illegal transitions raise; a Hypothesis state machine drives random lifecycles and checks every invariant after each step. **Evidence:** `tests/test_cloud_jobs_stateful.py::test_random_lifecycles_keep_every_invariant`, `tests/test_cloud_jobs_lifecycle.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
2. **SC-0394-02 - Leases and fencing.** **Acceptance:** A completion with a stale fencing token is refused; the zombie-worker scenario publishes once. **Required verification:** Integration race test. **Implementation:** Implemented; claims issue a fencing token that rises with every claim; completion from a stale holder is refused and publishes nothing; PostgreSQL races prove one winner and no deadlock. **Evidence:** `tests/test_cloud_jobs_claim.py::test_each_claim_increments_the_fencing_token_by_one`, `tests/test_cloud_jobs_lifecycle.py`, `tests/test_cloud_jobs_races.py` (PostgreSQL, 7 passed); green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
3. **SC-0394-03 - Reaper.** **Acceptance:** Expired attempts return to queued or fail when attempts are exhausted, within lease + interval. **Required verification:** Kill-loop chaos test. **Implementation:** Implemented; a kill-loop chaos test starts and kills workers part-way through attempts (in-process over 40 rounds, and as real OS processes) while the maintenance loop reaps; every lost attempt is reaped within lease + interval, its job is queued again, failed when its attempts are spent or quarantined after three crashed workers; killed workers that come back are fenced out, nothing is published twice, and the invariants hold. **Evidence:** `tests/test_cloud_jobs_chaos.py` (5 passed on 2026-11-10: virtual-clock loop, real-process kills and the maintenance-thread loop on SQLite, and the maintenance-thread loop on PostgreSQL 16). **Independently Verified:** No.
4. **SC-0394-04 - Local runner.** **Acceptance:** Seam worker pipe, analysis subprocess and export JSON jobs are replaced in local mode; transitions sound the same. **Required verification:** Existing tests plus the owner's listening check. **Implementation:** In progress; cooperative durable runner supports injected handlers, but local audio jobs still use existing workers. **Independently Verified:** No.
5. **SC-0394-05 - Error classes and quarantine.** **Acceptance:** Each error class follows its retry policy; a job that crashes three workers is quarantined. **Required verification:** Unit and chaos tests. **Implementation:** Implemented; transient, resource, input, dependency, poison and engine-bug classes follow their retry policies; a job that crashes three workers is quarantined. **Evidence:** `tests/test_cloud_jobs_failures.py::test_transient_errors_retry_with_backoff_until_attempts_run_out`, `tests/test_cloud_jobs_failures.py::test_poison_and_three_crashed_workers_quarantine`, `tests/test_cloud_scheduling_simulator.py::test_workers_that_keep_dying_quarantine_the_job`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
6. **SC-0394-06 - Outbox.** **Acceptance:** Every transition writes an outbox event in the same transaction. **Required verification:** Integration test. **Implementation:** Implemented; enqueue, claim and every lifecycle transition write one outbox event in the same transaction and wake the pool. **Evidence:** `tests/test_cloud_jobs_enqueue.py::test_enqueue_writes_one_outbox_event_and_wakes_the_pool`, `tests/test_cloud_jobs_claim.py::test_a_claim_writes_one_outbox_event_naming_its_attempt_and_worker`, `tests/test_cloud_jobs_lifecycle.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
