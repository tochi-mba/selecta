# Operations runbooks

One runbook per alert (ADR-0410). Alerts and SLOs are code in `infra/observability/`;
`tests/test_cloud_slos.py` fails when an alert has no runbook here or a runbook lacks its
sections.

## SLO burn alerts

- [API availability](slo-api-availability.md)
- [Routine API latency](slo-api-latency.md)
- [Interactive seam start](slo-seam-start.md)
- [Accepted job lost](slo-lost-jobs.md)
- [Webhook to entitlement](slo-webhook-entitlement.md)

## Phone alerts

- [API down](api-down.md)
- [Oldest interactive job over 2 minutes](oldest-interactive-job.md)
- [Jobs quarantined](jobs-quarantined.md)
- [Spend ceiling hit](spend-ceiling.md)
- [Audit writes stopped](audit-writes-stopped.md)
- [Reconciliation drift](reconciliation-drift.md)
- [Backup failed](backup-failed.md)
- [Maintenance service down](maintenance-service-down.md)

## Procedures

- [Backups and the restore drill](backup-and-restore.md)
- [Emergency controls](emergency/README.md)
- [Game day: emergency controls drill](game-day.md)
