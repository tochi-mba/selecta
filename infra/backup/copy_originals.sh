#!/usr/bin/env bash
# Nightly copy of originals to the backup account (ADR-0409, §13.5).
# Copy, never sync-with-delete: a deletion only reaches the backup when the deletion ledger's
# physical purge runs after the 30-day recovery window (selecta storage-maintenance), so a bug
# or a stolen production key can't empty the backup. Derived data is not backed up.
#
# Needs rclone and two remotes in RCLONE_CONFIG (read-only source, write-only target):
#   [source] type = s3, provider = Cloudflare, endpoint = https://<prod-account>.eu.r2...
#   [backup] type = s3, provider = Cloudflare, endpoint = https://<backup-account>.eu.r2...
# and SOURCE_BUCKET (selecta-<env>-originals), BACKUP_BUCKET (selecta-<env>-originals-backup).
set -euo pipefail

: "${SOURCE_BUCKET:?}" "${BACKUP_BUCKET:?}"
rclone copy "source:${SOURCE_BUCKET}" "backup:${BACKUP_BUCKET}" \
  --immutable --checksum --transfers 16 --s3-storage-class InfrequentAccess \
  --stats-one-line --stats 0 --log-level NOTICE
echo "Originals copied to backup:${BACKUP_BUCKET}"
