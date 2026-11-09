# ADR-0394 — Durable jobs with leases and fencing

- **Decision:** Proposed (owner review pending).
- **Implementation:** 0/6 Implemented; 0/6 In progress; 6/6 Not started.
- **Independent verification:** 0/6 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0076 (incremental migration and rollback); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/seams.py`; `src/selecta/seam_worker.py`; `src/selecta/jobs.py`; `src/selecta/eta.py`; `src/selecta/api_common.py`; `src/selecta/routes/exports.py`; `src/selecta/recovery.py`; new `src/selecta/jobs/`, `src/selecta/workers/`.
- **Proposal chapter:** [docs/saas/04-queue-and-scheduling.md](../saas/04-queue-and-scheduling.md#4a3-lifecycle).

## Context and evidence boundary

Background work is coordinated through a stdin pipe to one seam-worker subprocess, in-memory deques, `seam.json` status files, a `rendering-mix` sign file, an analysis subprocess and JSON export-job files tracked in a process dict. None of it survives multiple instances or remote workers, and some of it corrupts state when a second instance starts.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

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

## Implementation checklist — 0/6 Implemented; 0/6 independently Verified

1. **SC-0394-01 — Job tables and state module.** **Acceptance:** All transitions go through one module; illegal transitions raise. **Required verification:** Hypothesis state-machine tests. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0394-02 — Leases and fencing.** **Acceptance:** A completion with a stale fencing token is refused; the zombie-worker scenario publishes once. **Required verification:** Integration race test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0394-03 — Reaper.** **Acceptance:** Expired attempts return to queued or fail when attempts are exhausted, within lease + interval. **Required verification:** Kill-loop chaos test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0394-04 — Local runner.** **Acceptance:** Seam worker pipe, analysis subprocess and export JSON jobs are replaced in local mode; transitions sound the same. **Required verification:** Existing tests plus the owner's listening check. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0394-05 — Error classes and quarantine.** **Acceptance:** Each error class follows its retry policy; a job that crashes three workers is quarantined. **Required verification:** Unit and chaos tests. **Implementation:** Not started; **Independently Verified:** No.
6. **SC-0394-06 — Outbox.** **Acceptance:** Every transition writes an outbox event in the same transaction. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Decision Proposed until the owner says otherwise. Older ADRs keep their statuses; this one only links to them.
