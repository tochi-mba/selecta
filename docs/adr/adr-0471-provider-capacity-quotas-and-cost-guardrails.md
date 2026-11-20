# ADR-0471 - Provider capacity, quotas and cost guardrails

- **Decision:** Proposed (Codex for the owner, 2026-11-20).
- **Programme:** Service Operations (OP).
- **Implementation:** In progress: internal AI and storage guards exist; provider-limit collection does not.
- **Source touchpoints:** `src/selecta/usage/`, `src/selecta/ai/`, `src/selecta/admin/read_models.py`, `infra/observability/`.

## Context

A service can be healthy while unable to accept the next request: a database can be near its connection cap, Modal can have no concurrency, R2 can be throttled, Anthropic can be rate-limited, or an account can be near a monthly budget. Today's admin spend metrics are declared but have no production reporters.

## Decision

1. Collect limits separately from health. Each reading has `used`, `soft_limit`, `hard_limit`, unit, reset time, source, as-of time and confidence (`provider`, `configured`, `estimated`).
2. Track at least Render instance/database capacity, Postgres connections/storage, R2 storage and request classes, Modal concurrency/GPU spend, Anthropic token/rate/spend limits, Stripe balance/webhook backlog, WorkOS rate limits, Resend sends, Grafana ingestion and Sentry event volume.
3. Normalize utilization to percentages only when numerator and denominator describe the same window. Unknown denominators remain unknown.
4. Thresholds default to notice at 70%, warning at 85%, critical at 95% and exhausted at 100%, with provider-specific overrides and forecast alerts when exhaustion is predicted before reset.
5. Enforced application ceilings remain authoritative. A dashboard alert never silently raises a budget, upgrades a plan or disables a customer feature.
6. Every cost number names currency and whether tax, credits and delayed vendor reporting are included. Estimated cost is labelled estimated.
7. Reset-aware alerts resolve automatically only after a fresh measurement proves recovery.

## Guardrail actions

- Queue or shed speculative work before interactive work.
- Fall back from paid AI to an allowed cheaper or built-in deployment.
- Pause new uploads before storage exhaustion while preserving playback and deletion.
- Stop nonessential telemetry before its billable ingestion cap, without suppressing security/audit evidence.
- Require an Owner and a recorded reason for any budget increase.

## Rejected alternatives

- Scraping dashboard HTML: use provider APIs or controlled configuration values.
- Treating a credit-card limit as the platform safety ceiling.
- Showing a percentage from stale or mismatched billing windows.

## Acceptance

The [Service Operations checklist](selecta-service-operations-implementation-checklist.md) OP-0471 items define implementation and verification.
