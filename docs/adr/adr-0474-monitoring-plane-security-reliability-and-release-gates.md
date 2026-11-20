# ADR-0474 - Monitoring-plane security, reliability and release gates

- **Decision:** Proposed (Codex for the owner, 2026-11-20).
- **Programme:** Service Operations (OP).
- **Implementation:** Not started as one end-to-end monitoring plane.
- **Source touchpoints:** `src/selecta/observability/`, `src/selecta/admin/`, `infra/observability/`, `infra/staging/`, `docs/operations/`.

## Context

Monitoring handles provider credentials, infrastructure identifiers and failure evidence. If it shares every failure domain with the app, it may disappear during the incident it should report. If probes are too privileged, a compromised monitor becomes a production control plane.

## Decision

1. Probe identities are read-only and environment-scoped. They cannot deploy, alter billing, read customer content, delete objects, manage users or change provider limits.
2. Monitoring credentials live in the deployment secret store or future credential broker, never in GitHub, browser code, logs, metric labels or incident text.
3. The external heartbeat/status path uses infrastructure independent of the primary Render services and primary Postgres database. The in-app console may depend on the app, but the dead-man alert may not.
4. Probe execution is bounded by timeout, concurrency and request budget. Circuit breakers prevent an outage from causing a probe storm.
5. Health writes are append/replace measurements only. Probe workers cannot invoke emergency controls.
6. Retention separates low-cardinality operational metrics from security/audit evidence. Customer ids, emails, song metadata, filenames, prompts and webhook payloads are prohibited from metric labels.
7. Every new production dependency must add a registry entry, probe or documented exception, limits source, runbook, alert ownership and failure test before release.
8. Staging runs dependency-failure game days: expired credential, timeout, rate limit, quota exhaustion, webhook backlog, stale monitor and false recovery.
9. Production launch is blocked if a critical dependency is Unknown, its alert route is untested, or its runbook has no safe recovery procedure.

## Failure containment

- Probe failure cannot fail an application request.
- Telemetry export failure uses bounded buffers and drops ordinary diagnostics before exhausting process memory or disk.
- Security/audit recording follows its existing durable contract and is not silently dropped with telemetry.
- Monitoring schema changes are backward compatible across a rolling deploy.

## Rejected alternatives

- A single administrator API token shared across all probes.
- Hosting the only uptime check inside the API it checks.
- Making production readiness depend synchronously on the observability vendor.

## Acceptance

The [Service Operations checklist](selecta-service-operations-implementation-checklist.md) OP-0474 items define implementation and verification.
