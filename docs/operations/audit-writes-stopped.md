# Audit writes stopped

Alert: `SelectaAuditWritesStopped` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

Mutations are being served but no audit rows have been written for 15 minutes. Admin actions without audit records break the security model.

## First checks

1. Database: is the audit table writable (disk, permissions, a failed migration)?
2. API traces: errors on admin routes; the audit writer's exceptions in Sentry.

## Safe actions

- Put the app in [read-only mode](emergency/read-only.md) if admin changes might be going unaudited.
- Run no admin commands until audit writes resume.
