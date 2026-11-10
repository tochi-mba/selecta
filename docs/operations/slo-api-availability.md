# API availability SLO burning

Alert: `SelectaSloBurn_api_availability_page / _ticket` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

More than the 0.5% budget of API requests are failing with 5xx (span status error). The page fires at 14.4 times the allowed rate (2% of the month's budget gone in an hour), the ticket at 6 times.

## First checks

1. Grafana dashboard `selecta-slo-api_availability`: is it one route or all of them? The span name is the route template.
2. Render: are API instances restarting or failing health checks (`/api/ready`)? A `migrations_pending` answer means a deploy ran ahead of its migration.
3. Database: connection count against the PgBouncer limit; slow queries; Render Postgres status.
4. Sentry: a new exception class since the last deploy?

## Safe actions

- Roll back: redeploy the previous image tag from the deploy workflow (production needs the usual approval).
- Shed load: [pause uploads](emergency/uploads-paused.md) or [pause admission](emergency/admission-paused.md) if workers or uploads are the pressure.
- Last resort: [read-only app](emergency/read-only.md) keeps reads working while writes fail safely.
