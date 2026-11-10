# API down

Alert: `SelectaApiDown` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

No API instance answers its scrape or health check for two minutes. Customers see the status page.

## First checks

1. Render dashboard: are instances running, deploying or crash-looping? Read the last deploy's logs.
2. Cloudflare: DNS for the API hostname, WAF rules blocking everything, origin errors (52x).
3. Is the database reachable? `/api/ready` answers `database_unavailable` when it isn't.

## Safe actions

- Roll back to the previous image tag.
- Post on the status page (separate infrastructure) within 10 minutes.
- When it is back, check [maintenance](maintenance-service-down.md) and that event streams reconnect.
