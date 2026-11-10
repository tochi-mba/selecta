#!/usr/bin/env bash
# Monthly restore drill in staging (ADR-0409, SC-0409-04). Target: under 60 minutes in total.
#
# 1. Start the clock. 2. Restore the latest nightly dump into an empty drill database.
# 3. Bring it to the current schema. 4. Run every post-restore step, in order (replay the
# deletions ledger, storage reconciliation, Stripe reconciliation, expire leases), timed from
# step 1, with `python -m selecta.ops.restore_drill`. 5. Keep the report as the drill record:
# docs/operations/drills/restore-<date>.md. The drill database is never customer-facing.
#
# Needs: pg_restore 17, aws CLI, the image's `selecta` and
#   DRILL_DATABASE_URL     an empty PostgreSQL database for the drill (direct connection)
#   BACKUP_S3_ENDPOINT, BACKUP_BUCKET, and read-only AWS_* keys for the dump bucket
#   SELECTA_R2_* and SELECTA_R2_BUCKET_DELETION_LEDGER for the staging ledger (read-only)
set -euo pipefail

: "${DRILL_DATABASE_URL:?}" "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_BUCKET:?}"
started="$(date -u +%s)"
day="$(date -u +%Y-%m-%d)"
report_dir="${REPORT_DIR:-docs/operations/drills}"
mkdir -p "${report_dir}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

latest="$(aws s3 cp --only-show-errors --endpoint-url "${BACKUP_S3_ENDPOINT}" \
  "s3://${BACKUP_BUCKET}/LATEST" -)"
for file in selecta.dump selecta.dump.sha256; do
  aws s3 cp --only-show-errors --endpoint-url "${BACKUP_S3_ENDPOINT}" \
    "s3://${BACKUP_BUCKET}/${latest}/${file}" "${work}/${file}"
done
echo "$(cat "${work}/selecta.dump.sha256")  ${work}/selecta.dump" | sha256sum --check --quiet

pg_restore --no-owner --no-privileges --exit-on-error --jobs 4 \
  --dbname "${DRILL_DATABASE_URL}" "${work}/selecta.dump"
SELECTA_MODE=cloud SELECTA_DATABASE_URL="${DRILL_DATABASE_URL}" selecta db upgrade

SELECTA_MODE=cloud SELECTA_DATABASE_URL="${DRILL_DATABASE_URL}" \
  python -m selecta.ops.restore_drill --restore-started "${started}" \
  --report "${report_dir}/restore-${day}.md"
