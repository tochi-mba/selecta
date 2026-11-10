# Backups and the restore drill

Decision: [ADR-0409](../adr/adr-0409-hosting-topology-and-environments.md), [§13.5](../saas/13-hosting-and-cost.md#135-backups-and-disaster-recovery). Target: a database restore, start to reopened, in under 60 minutes.

## What is backed up

| What | How | Where | Kept |
|---|---|---|---|
| PostgreSQL | Render point-in-time recovery | Render | Render's PITR window |
| PostgreSQL | `infra/backup/nightly_db_dump.sh` (custom-format dump, checksum, `LATEST` pointer) | `selecta-<env>-db-dumps`, separate Cloudflare account | 35 days |
| Originals | `infra/backup/copy_originals.sh` (`rclone copy`, never sync-with-delete) | `selecta-<env>-originals-backup`, separate account, Infrequent Access | Until the 30-day purge after deletion |
| Deletion ledger | Mirrored by `selecta storage-maintenance` | `SELECTA_R2_BUCKET_DELETION_LEDGER` | Always |

Derived data (proxies, stems, renders) is not backed up; it is regenerated.

## After any restore (real or drill)

Keep customer traffic closed until every step passes, in this order:

1. Replay the deletions ledger: storage tombstones, then account deletions.
2. Storage reconciliation: ledger, quota and inventory must agree.
3. Stripe reconciliation.
4. Expire leases held by workers from before the restore.
5. Reopen.

`python -m selecta.ops.restore_drill --restore-started <epoch> --report <file>.md` runs steps 1 to 4, times each, stops at the first failure and writes the report. `selecta replay-deletions-after-restore` still runs step 1 alone.

## Monthly drill (staging)

Run `infra/backup/restore_drill.sh` with an empty drill database. It starts the clock, fetches and checksums the latest dump, restores it, upgrades the schema, then runs the steps above. File the report as `docs/operations/drills/restore-<date>.md`. A drill passes when every step succeeded and the total is under 60 minutes.

## First checks

1. Is the latest dump less than 26 hours old (`LATEST` in the dump bucket)?
2. Does its checksum match?
3. Can the drill database accept a restore of that size within the time budget?

## Safe actions

- Never restore over production without the API and workers closed to customers.
- If a drill fails, open a ticket with the report; do not change backup jobs in the same change as a fix to the product.
