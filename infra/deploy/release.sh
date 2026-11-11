#!/usr/bin/env bash
# One release of Selecta Cloud to one environment (ADR-0409): expand migrations, then services,
# then workers, then the edge. Old workers keep working through it because migrations only
# expand; contracting migrations ship in a later release.
#
# Needs (from oidc_credentials.sh): DATABASE_URL, RENDER_API_KEY, RENDER_SERVICE_IDS,
# MODAL_TOKEN_ID, MODAL_TOKEN_SECRET, CLOUDFLARE_API_TOKEN, BACKUP_API_TOKEN,
# CLOUDFLARE_ACCOUNT_ID, BACKUP_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY, TOFU_STATE_ENDPOINT. And: SELECTA_ENVIRONMENT, TAG, IMAGE.
set -euo pipefail

: "${SELECTA_ENVIRONMENT:?}" "${TAG:?}" "${IMAGE:?}"
case "${SELECTA_ENVIRONMENT}" in
  staging|production) ;;
  *) exit 64 ;;
esac
for tool in docker curl uv tofu; do
  command -v "${tool}" >/dev/null || { echo "::error::${tool} is not installed on this runner." >&2; exit 1; }
done

echo "1. Migrations (expand only) with the new image"
docker run --rm -e SELECTA_MODE=cloud -e SELECTA_DATABASE_URL="${DATABASE_URL}" \
  "${IMAGE}:${TAG}" selecta db upgrade

echo "2. Render services to ${TAG}"
for service in ${RENDER_SERVICE_IDS}; do
  curl -fsS -X PATCH "https://api.render.com/v1/services/${service}" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" -H "Content-Type: application/json" \
    --data "{\"image\": {\"imagePath\": \"${IMAGE}:${TAG}\"}}" >/dev/null
  curl -fsS -X POST "https://api.render.com/v1/services/${service}/deploys" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" -H "Content-Type: application/json" \
    --data '{"clearCache": "do_not_clear"}' >/dev/null
done

echo "3. Modal workers from the same commit"
uv tool run --from modal modal deploy infra/modal/selecta_workers.py --env "${SELECTA_ENVIRONMENT}"

echo "4. Cloudflare (OpenTofu)"
export TF_VAR_cloudflare_api_token="${CLOUDFLARE_API_TOKEN}"
export TF_VAR_backup_api_token="${BACKUP_API_TOKEN}"
export TF_VAR_account_id="${CLOUDFLARE_ACCOUNT_ID}"
export TF_VAR_backup_account_id="${BACKUP_ACCOUNT_ID}"
export TF_VAR_zone_id="${CLOUDFLARE_ZONE_ID}"
cd infra/cloudflare
tofu init -input=false -backend-config="env/${SELECTA_ENVIRONMENT}.backend.hcl" \
  -backend-config="endpoints={s3=\"${TOFU_STATE_ENDPOINT}\"}"
tofu apply -input=false -auto-approve -var-file="env/${SELECTA_ENVIRONMENT}.tfvars"
