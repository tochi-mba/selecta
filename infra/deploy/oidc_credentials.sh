#!/usr/bin/env bash
# Trade this job's GitHub OIDC token for short-lived deploy credentials (ADR-0409, SC-0409-03).
#
# No long-lived deploy secret is stored in GitHub. The job asks GitHub for an OIDC token whose
# audience is the Selecta credential broker; the broker checks the token's repository, ref,
# workflow and environment claims and returns credentials scoped to that one environment that
# expire within the hour. Each value is masked before it reaches the job environment.
#
# Usage: oidc_credentials.sh <environment>
# Needs: permissions id-token: write; vars.SELECTA_CREDENTIAL_BROKER_URL.
set -euo pipefail

environment="${1:?environment}"
broker="${SELECTA_CREDENTIAL_BROKER_URL:?Set the SELECTA_CREDENTIAL_BROKER_URL repository variable}"
audience="selecta-deploy"

if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" || -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]]; then
  echo "::error::This job has no OIDC token; give it permissions id-token: write." >&2
  exit 1
fi

oidc="$(curl -fsS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${audience}" | jq -r '.value')"
echo "::add-mask::${oidc}"

answer="$(curl -fsS -X POST -H "Authorization: Bearer ${oidc}" \
  -H "Content-Type: application/json" \
  --data "{\"environment\": \"${environment}\"}" "${broker%/}/v1/deploy-credentials")"

# The broker answers {"credentials": {"NAME": "value", ...}, "expires_in": seconds}.
expires="$(jq -r '.expires_in' <<<"${answer}")"
if [[ "${expires}" -gt 3600 ]]; then
  echo "::error::The broker returned credentials that live longer than an hour." >&2
  exit 1
fi
while IFS=$'\t' read -r name value; do
  [[ "${name}" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "::error::Bad credential name." >&2; exit 1; }
  echo "::add-mask::${value}"
  {
    echo "${name}<<SELECTA_EOF"
    echo "${value}"
    echo "SELECTA_EOF"
  } >>"${GITHUB_ENV}"
done < <(jq -r '.credentials | to_entries[] | [.key, .value] | @tsv' <<<"${answer}")
