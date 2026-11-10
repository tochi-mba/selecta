# ADR-0409 - Hosting topology, regions and environments

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
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

1. **SC-0409-01 - Staging environment.** **Acceptance:** Full stack runs end to end with synthetic users. **Required verification:** Staging smoke test. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0409-02 - IaC.** **Acceptance:** Staging and production are reproducible from the repo. **Required verification:** Recreate staging from scratch. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0409-03 - Deploy pipeline.** **Acceptance:** Main deploys to staging; production needs approval; OIDC credentials only. **Required verification:** Pipeline run. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0409-04 - Backups and restore.** **Acceptance:** Restore drill completes in under 60 minutes. **Required verification:** Drill report. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
