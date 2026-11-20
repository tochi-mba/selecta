# ADR-0473 - Admin operations overview and diagnostics

- **Decision:** Proposed (Codex for the owner, 2026-11-20).
- **Programme:** Service Operations (OP).
- **Implementation:** In progress: the Overview, freshness rendering, alerts and emergency controls exist.
- **Source touchpoints:** `web/src/admin/OverviewPage.tsx`, `web/src/admin/parts.tsx`, `src/selecta/admin/read_models.py`, `src/selecta/admin/routes.py`.

## Context

The current Overview renders internal metric names and raw values. That is useful scaffolding, but an operator should not need to remember whether `1`, `0`, null or an old timestamp means safe. It also does not show Render, WorkOS, Resend, Grafana or Sentry.

## Decision

1. The first screen answers four questions in order: Are customers affected? What capability is affected? Is a fallback active? What should I do next?
2. Show one card per customer capability—sign in, browse/listen, uploads/storage, processing, Lucy, billing, email and telemetry—with its contributing dependencies underneath.
3. Status words and icons accompany colour: Healthy, Degraded, Down, Unknown and Not configured. Stale data shows its last successful measurement and never appears green.
4. Each dependency row shows latency, utilization/limit where available, last checked, active incident and runbook. Technical identifiers are available in details, not used as the primary label.
5. Environment is always visible. Production and staging data cannot be combined into one status.
6. Job backlog, worker availability, webhook lag, spend and capacity forecasts receive explicit thresholds and plain-language explanations.
7. The page polls only while visible, backs off on failure and announces only meaningful status changes to assistive technology.
8. Emergency controls remain separate from diagnostics. A health failure may recommend a control but never engages it automatically unless a separate accepted ADR explicitly authorizes that automation.
9. Provider-console deep links contain only non-secret resource identifiers and open in a new context with an accessible warning.

## Truth rules

- No measurements means Unknown, not zero and not Healthy.
- A healthy process plus a down required dependency makes the capability Down.
- A working fallback makes the capability Degraded, not Healthy.
- `not_configured` is acceptable only for an explicitly optional pre-launch dependency.
- Historical charts label gaps rather than interpolating through them.

## Rejected alternatives

- A wall of vendor logos and green/red dots without capability impact.
- Raw Prometheus/Grafana queries embedded in the staff console.
- Automatically changing infrastructure from a diagnostic page.

## Acceptance

The [Service Operations checklist](selecta-service-operations-implementation-checklist.md) OP-0473 items define implementation and verification.
