# Backup failed

Alert: `SelectaBackupFailed` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

No nightly database dump or originals copy succeeded in 26 hours. Point-in-time recovery still covers the database, but the off-account copy is stale.

## First checks

1. Scheduler logs for `infra/backup/nightly_db_dump.sh` and `infra/backup/copy_originals.sh`.
2. Backup account credentials expired or revoked? Bucket lifecycle or quota?
3. Is Render Postgres reachable on a direct connection?

## Safe actions

- Run the dump by hand once fixed and confirm `LATEST` moved.
- If the backup account looks compromised, rotate its keys before anything else.
- Run a [restore drill](backup-and-restore.md) after any backup outage longer than a week.
