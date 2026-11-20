# ADR-0472 - Alert routing, incidents and escalation

- **Decision:** Proposed (Codex for the owner, 2026-11-20).
- **Programme:** Service Operations (OP).
- **Implementation:** In progress: internal platform alerts and SLO rule files exist; provider incidents are not joined to them.
- **Source touchpoints:** `src/selecta/admin/alerts.py`, `src/selecta/admin/schema.py`, `infra/observability/`, `docs/operations/`.

## Context

Health tables help only when someone is looking. A solo operator needs few, actionable notifications that identify customer impact and a safe first action. Repeated probes must not create one alert per minute, while silence from the monitoring system must itself be visible.

## Decision

1. A condition becomes one incident keyed by environment, dependency, capability and failure class. Further observations update that incident instead of paging again.
2. Severities are: `info` (record only), `warning` (dashboard and ticket), `critical` (immediate owner notification) and `emergency` (customer safety/data risk and immediate notification).
3. Critical notification requires sustained failure or a multi-window SLO burn, except for data loss, security, cross-tenant access, billing corruption and total production unavailability, which notify immediately.
4. Every notification includes environment, affected capability, first/last seen, freshness, customer impact, safe first check, runbook link and whether an automatic fallback is active. It contains no secret or customer content.
5. Acknowledgement, mitigation, resolution and false-positive decisions are audited. Resolution requires fresh recovery evidence; acknowledgement alone never resolves an incident.
6. Alerts deduplicate across Grafana/Sentry/application sources by incident key and retain source links.
7. A dead-man signal pages when the production monitoring heartbeat is missing for two expected intervals.
8. Provider status incidents may annotate an incident but cannot close it while Selecta's own probe still fails.

## Default routing

| Severity | Route | Response expectation |
|---|---|---|
| Info | Admin timeline | Review during normal operations |
| Warning | Admin + durable ticket/email | Same working day |
| Critical | Admin + phone/push + email | Begin triage within 15 minutes |
| Emergency | Critical routes plus explicit safety banner | Immediate |

## Rejected alternatives

- Paging on every failed probe.
- Closing an incident because a vendor status page says resolved.
- Sending raw exception bodies or request payloads to a notification channel.

## Acceptance

The [Service Operations checklist](selecta-service-operations-implementation-checklist.md) OP-0472 items define implementation and verification.
