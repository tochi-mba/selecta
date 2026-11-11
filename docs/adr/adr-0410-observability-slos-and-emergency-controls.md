# ADR-0410 - Observability, SLOs and emergency controls

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 1/4 Implemented; 3/4 In progress; 0/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 7. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0409; their statuses are unchanged.
- **Source touchpoints:** new `docs/operations/`; OpenTelemetry instrumentation across `src/selecta/`.
- **Proposal chapter:** [docs/saas/14-operations.md](../saas/14-operations.md).

## Context and evidence boundary

A solo operator needs to know quickly when something breaks and have safe, rehearsed actions.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- OpenTelemetry traces across API, gateway and workers with job ids as span attributes; low-cardinality metrics.
- Beta SLOs: API availability 99.5%, routine p95 under 300 ms, interactive seam start p95 under 10 s when capacity exists, zero lost accepted jobs, webhook-to-entitlement p95 under 60 s.
- Phone alerts for the listed conditions, each with a runbook.
- Emergency controls are declarative states (pause uploads, pause a pool, drain, disable speculative work, disable Lucy or a deployment, billing safe mode, read-only app, close sign-ups), not scripts.
- A status page on separate infrastructure.

## User outcome and acceptance contract

Incidents are noticed in minutes and handled with known-safe steps.

## Rejected alternatives

- High-cardinality labels (user or job ids) on metrics.
- Emergency scripts run from a browser.

## Implementation checklist - 1/4 Implemented; 0/4 independently Verified

1. **SC-0410-01 - Tracing.** **Acceptance:** One trace follows a job from API to worker to storage. **Required verification:** Staging trace review. **Implementation:** In progress; `src/selecta/observability/tracing.py` (flag `cloud.tracing`) derives each job's trace id from its id, so the API's `job.enqueue` span (linked to the HTTP request that made it), the gateway's `job.wait`, `job.claim` and `job.complete` spans, the worker's `worker.run` span and its `storage.get` and `storage.put` spans all land in one trace with `selecta.job_id` as a span attribute; the worker's gateway calls carry `traceparent`, so the gateway's server span nests under `worker.run`; server spans are named by route template and 5xx marks them as errors; export needs the optional `observability` extra and `OTEL_EXPORTER_OTLP_ENDPOINT`. Needs staging: a trace reviewed in Grafana Cloud from a real job **Evidence:** `tests/test_cloud_tracing.py` with the SDK's in-memory exporter (10 passed on SQLite and PostgreSQL on 2026-11-10); rerun on 2026-11-11 with `tests/test_cloud_runner_remote.py`, `tests/test_worker_gateway_api.py` and `tests/test_cloud_restore_drill.py`: 67 passed on SQLite (the PostgreSQL variants could not connect while the local server was starting up). **Independently Verified:** No.
2. **SC-0410-02 - SLO dashboards and alerts.** **Acceptance:** Each SLO has a dashboard and burn alert. **Required verification:** Alert test. **Implementation:** In progress; `infra/observability/slos.yaml` defines the five beta SLOs and `python -m selecta.observability.slo_rules --write` generates a Grafana dashboard per SLO and page (14.4x over 1 h and 5 m) and ticket (6x over 6 h and 30 m) burn alerts in `infra/observability/generated/`; the Python burn logic is tested at the workbook rates; API availability, routine latency and seam start read span metrics the code now emits; the lost-jobs and webhook-to-entitlement SLIs and the phone alerts in `alerts.yaml` read `selecta_*` metrics that are not emitted yet. Needs staging: emit those metrics, load the rules and dashboards into Grafana Cloud and fire a test alert **Evidence:** `src/selecta/observability/slo_rules.py`; `tests/test_cloud_slos.py` (33 passed with `tests/test_cloud_infra.py` on 2026-11-10). **Independently Verified:** No.
3. **SC-0410-03 - Runbooks.** **Acceptance:** Every alert links to a runbook. **Required verification:** Doc review. **Implementation:** Implemented; every generated alert (10 SLO burn alerts and 8 phone alerts) carries a `runbook_url` to a page in `docs/operations/` with What it means, First checks and Safe actions, listed in `docs/operations/README.md`; the test fails when an alert has no runbook, a runbook lacks its sections or a link in `docs/operations/` is broken **Evidence:** `docs/operations/README.md`; `infra/observability/alerts.yaml`; `tests/test_cloud_slos.py::test_every_alert_links_a_runbook_with_its_sections` and `::test_the_runbook_index_lists_every_runbook_and_every_link_resolves` (33 passed with `tests/test_cloud_infra.py` on 2026-11-10). **Independently Verified:** No.
4. **SC-0410-04 - Emergency controls.** **Acceptance:** Each control works and is audited; recovery restores normal state. **Required verification:** Game-day drill. **Implementation:** In progress; typed engage/recover controls, durable state, audit records and owner alerts have focused integration coverage; the game-day procedure is written in `docs/operations/game-day.md`. Needs a person: the game-day drill itself in staging with an operator and an observer, and its record filed **Evidence:** `src/selecta/admin/emergency.py`; `tests/test_cloud_admin_backend.py`; `docs/operations/game-day.md`. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
