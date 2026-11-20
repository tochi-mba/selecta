# ADR-0470 - Live dependency health, readiness and synthetic probes

- **Decision:** Proposed (Codex for the owner, 2026-11-20).
- **Programme:** Service Operations (OP), following ADR-0410 rather than replacing it.
- **Implementation:** In progress: the admin metric names and freshness model exist; external probes do not.
- **Source touchpoints:** `src/selecta/admin/read_models.py`, `src/selecta/observability/`, `src/selecta/maintain.py`, `web/src/admin/OverviewPage.tsx`, `infra/observability/`.

## Context

The staff Overview already reserves health readings for the API, Postgres, R2, Modal, Anthropic and Stripe webhooks. Only Postgres is populated by application code. A missing measurement is correctly shown as unknown, but no component currently measures most dependencies. Render, WorkOS, Resend, Grafana and Sentry are absent from the inventory.

An HTTP 200 from a vendor status page is not enough. Selecta needs to know whether its own account, credentials, region and critical path work without performing customer-visible or billable mutations.

## Decision

1. Maintain a typed dependency registry for Render API/gateway/maintenance, Postgres, R2, Modal, WorkOS, Stripe, Anthropic, Resend, Grafana OTLP and Sentry ingestion.
2. Every dependency declares owner, criticality, environments, probe type, interval, timeout, freshness limit, safe-mode consequence, runbook and redaction policy.
3. States are `healthy`, `degraded`, `down`, `unknown` and `not_configured`. Unknown is never displayed as healthy.
4. Readiness checks only dependencies required to serve that process. Liveness proves the process is not wedged and never depends on a vendor.
5. Synthetic probes use a dedicated synthetic tenant and test-mode resources. They never use a customer, create a charge, send external mail, consume a production AI turn or mutate production identity.
6. Probe results are written through the admin metric/reporting boundary with latency, state and a low-cardinality reason. Secrets, response bodies, customer ids and vendor request payloads are excluded.
7. A provider's public status page is corroborating evidence, not the primary check.

## Probe contract

| Dependency | Safe probe | Down or degraded evidence |
|---|---|---|
| Render API/gateway | `/api/ready` and gateway readiness through public DNS | timeout, non-2xx, migration pending, wrong release |
| Maintenance | leader-term age and last successful task timestamp | no current leader or missed critical task |
| Postgres | transaction and pool saturation readings | query failure, exhausted pool, replication/connection pressure |
| R2 | signed HEAD/GET of a canary object in each required bucket | auth failure, missing bucket/object, latency threshold |
| Modal | worker heartbeat plus a bounded no-audio synthetic job | no eligible worker, claim/start timeout, platform rejection |
| WorkOS | read the dedicated synthetic user/organisation | auth failure, rate limit, wrong environment |
| Stripe | test-mode account read plus webhook-delivery age | auth failure, disabled endpoint, growing undelivered age |
| Anthropic | internal circuit/spend state; no periodic paid prompt | open circuit, sustained rate limit, exhausted budget |
| Resend | domain/API-key metadata read; no periodic email | auth failure, unverified domain, quota pressure |
| Grafana | exporter success/queue/drop metrics | rejected exports, queue saturation, sustained drops |
| Sentry | SDK transport outcome and sampled ingestion canary | rejected transport or missing canary after grace period |

## Consequences

- The admin console can distinguish unavailable, stale and not-yet-configured integrations.
- Probe code adds controlled vendor traffic and must obey provider rate limits.
- A failed optional dependency does not make an unrelated API process unready.

## Rejected alternatives

- One aggregate `health=1` number: it hides which capability is broken.
- Making liveness depend on Postgres or a vendor: an external outage would cause restart loops.
- Periodically sending real email, charging a card or calling a paid model as a health check.

## Acceptance

The [Service Operations checklist](selecta-service-operations-implementation-checklist.md) OP-0470 items define implementation and verification.
