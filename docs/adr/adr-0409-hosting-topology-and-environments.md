# ADR-0409 - Hosting topology, regions and environments

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 4/4 In progress; 0/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** None; their statuses are unchanged.
- **Source touchpoints:** new `services/`, `infra/`; `.github/workflows/`.
- **Proposal chapter:** [docs/saas/13-hosting-and-cost.md](../saas/13-hosting-and-cost.md#131-chosen-stack-beta).

## Context and evidence boundary

The code stays on GitHub. The stack must suit a solo operator, fit a $100–400/month beta budget, keep audio egress free and keep data in Europe.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

- Cloudflare for DNS, WAF, Pages and R2 (EU jurisdiction); Render (Frankfurt, Pro workspace) for API, gateway, maintenance and Postgres with PITR and its built-in PgBouncer; Modal (EU region) for all CPU and GPU workers at beta, with a reserved Hetzner CPU pool later; WorkOS, Stripe, Anthropic, Sentry, Grafana Cloud, a transactional email provider and an independent status page.
- Workers never run on Render: its 25 GB included egress and $0.15/GB beyond would make every upload to R2 expensive. Audio never passes through the API or gateway.
- Originals are copied nightly to a backup bucket in a separate account (Infrequent Access); physical deletion runs after a 30-day recovery window.
- Environments: local dev (`dev.cmd` for local mode, compose for cloud mode), PR previews, staging with Stripe test mode and capped AI keys, protected production.
- Images built on `main`, staging deployed automatically, production by approval; migrations expand then contract.
- OpenTofu for Cloudflare, `render.yaml` blueprint, Modal apps in code.

## User outcome and acceptance contract

A reproducible, affordable stack that can move compute vendors without touching producers or storage.

## Rejected alternatives

- Fly.io GPUs (withdrawn August 2026).
- Kubernetes at launch.
- S3 (egress fees).

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0409-01 - Staging environment.** **Acceptance:** Full stack runs end to end with synthetic users. **Required verification:** Staging smoke test. **Implementation:** In progress; the staging environment is defined in code (Render `staging` environment in `infra/render/render.yaml`, Cloudflare `infra/cloudflare/env/staging.tfvars`, Modal `selecta-workers-staging`), and `infra/deploy/smoke.py` checks both services are ready on the latest schema, refuse anonymous and unenrolled callers and, given a synthetic user's token, that the user can read their account and songs; it passes against the real Cloud API app and fails when a service is down. Needs staging: the accounts created, the stack deployed and the smoke test run end to end with synthetic users **Evidence:** `infra/deploy/smoke.py`; `tests/test_cloud_infra.py::test_the_smoke_test_passes_against_the_real_api_and_fails_when_a_service_is_down` (33 passed with `tests/test_cloud_slos.py` on 2026-11-10). **Independently Verified:** No.
2. **SC-0409-02 - IaC.** **Acceptance:** Staging and production are reproducible from the repo. **Required verification:** Recreate staging from scratch. **Implementation:** In progress; OpenTofu for Cloudflare (`infra/cloudflare/`: R2 buckets in the EU jurisdiction, backup and dump buckets in a separate account, Pages, DNS, WAF rate limits, per-environment tfvars and state), the Render Blueprint (`infra/render/render.yaml`: staging and protected production, API, gateway and two maintenance copies in Frankfurt, secrets `sync: false`), the Modal worker app (`infra/modal/selecta_workers.py`, EU, scale to zero) and the service image (`infra/docker/service.Dockerfile`) are parsed and checked by tests; `tofu validate` and `modal deploy` were not run (not installed here). Needs staging: recreate staging from scratch from these files with real accounts **Evidence:** `infra/`; `tests/test_cloud_infra.py` (33 passed with `tests/test_cloud_slos.py` on 2026-11-10). **Independently Verified:** No.
3. **SC-0409-03 - Deploy pipeline.** **Acceptance:** Main deploys to staging; production needs approval; OIDC credentials only. **Required verification:** Pipeline run. **Implementation:** In progress; `.github/workflows/deploy.yml` runs only on a push to main or by hand, never on pull requests, with `permissions: {}` and per-job least privilege; it builds one image, deploys staging, smoke-tests it, then waits for the protected production environment; deploy jobs trade their OIDC token for credentials that expire within the hour (`infra/deploy/oidc_credentials.sh`) and no stored secret is referenced; actionlint runs on it in the test workflow. Needs a person: the credential broker that accepts the GitHub OIDC token, required reviewers on the production environment, and the repository variables. Needs staging: a pipeline run **Evidence:** `.github/workflows/deploy.yml`; `infra/deploy/release.sh`; `tests/test_cloud_deploy_workflow.py` (8 passed on 2026-11-10). **Independently Verified:** No.
4. **SC-0409-04 - Backups and restore.** **Acceptance:** Restore drill completes in under 60 minutes. **Required verification:** Drill report. **Implementation:** In progress; nightly database dumps and originals copies to a separate account (`infra/backup/nightly_db_dump.sh`, `infra/backup/copy_originals.sh`), the drill script (`infra/backup/restore_drill.sh`) and `python -m selecta.ops.restore_drill`, which replays the deletions ledger, reconciles storage and Stripe and expires leases in order, times each step from the start of the restore, stops at the first failure and fails a recovery over 60 minutes; procedure in `docs/operations/backup-and-restore.md`. Needs staging: the first monthly drill run against a real dump and its report filed **Evidence:** `src/selecta/ops/restore_drill.py`; `tests/test_cloud_restore_drill.py` (8 engine tests passed on SQLite and PostgreSQL and 6 script checks passed on 2026-11-10). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
