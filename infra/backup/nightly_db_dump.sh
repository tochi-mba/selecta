#!/usr/bin/env bash
# Nightly logical dump of the Cloud database to the backup account's R2 (ADR-0409, §13.5).
# Render's point-in-time recovery is the first line; this dump survives losing the Render
# account or a bad PITR. The bucket lives in a separate Cloudflare account with its own keys
# (infra/cloudflare/main.tf, cloudflare_r2_bucket.db_dumps) and keeps 35 days.
#
# Needs: pg_dump 17, aws CLI (S3 API), and
#   DATABASE_URL           read-only replica or primary (a direct, non-pooled connection)
#   BACKUP_S3_ENDPOINT     https://<backup-account-id>.eu.r2.cloudflarestorage.com
#   BACKUP_BUCKET          selecta-<env>-db-dumps
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   write-only token for that bucket
# A failure exits non-zero, which the scheduler turns into the backup-failure alert.
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_BUCKET:?}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

pg_dump --format=custom --no-owner --no-privileges --compress=9 \
  --file="${work}/selecta.dump" "${DATABASE_URL}"
pg_restore --list "${work}/selecta.dump" >/dev/null  # the archive reads back
sha256sum "${work}/selecta.dump" | cut -d' ' -f1 >"${work}/selecta.dump.sha256"

for file in selecta.dump selecta.dump.sha256; do
  aws s3 cp --only-show-errors --endpoint-url "${BACKUP_S3_ENDPOINT}" \
    "${work}/${file}" "s3://${BACKUP_BUCKET}/${stamp}/${file}"
done
echo "${stamp}" | aws s3 cp --only-show-errors --endpoint-url "${BACKUP_S3_ENDPOINT}" \
  - "s3://${BACKUP_BUCKET}/LATEST"
echo "Dumped to s3://${BACKUP_BUCKET}/${stamp}/"
