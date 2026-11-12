# ADR-0403 - Stripe billing, reconciliation and UK VAT

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 3/5 Implemented; 2/5 In progress; 0/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0402; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/billing/`; `web/src/billing/`.
- **Proposal chapter:** [docs/saas/08-billing.md](../saas/08-billing.md#82-event-handling).

## Context and evidence boundary

Stripe collects payments; Selecta owns entitlements. Webhooks arrive late, twice or out of order, and the business is UK-based with VAT and consumer-law obligations.

The Cloud branch now has Checkout and portal session routes, server-side price selection, versioned consent capture, signature-verified webhook storage and current-state subscription reconciliation. This is an implementation slice, not evidence of a completed billing launch: live Stripe test mode, retry and nightly reconciliation workers, tax configuration and UI remain outstanding.

## Decision

- Stripe Checkout, Customer Portal, Stripe Tax and Smart Retries; a server-side map from price ids to plan versions.
- Each webhook is stored once and treated as a poke: re-fetch the subscription and recompute the entitlement snapshot; nightly full reconciliation.
- Upgrades immediate and prorated; downgrades and cancellations at period end; 7-day grace on failed renewals; overrides are separate, reasoned and expiring.
- Private beta takes payments from UK customers only; before EU sales, register for non-Union OSS or use a merchant of record.
- Checkout captures consent to immediate access and acknowledgement of the 14-day cancellation right.

## User outcome and acceptance contract

Paying never silently fails to unlock a plan, duplicates never double-apply, and tax obligations are met before they apply.

## Rejected alternatives

- Trusting the Checkout redirect alone.
- Applying events in arrival order without re-fetching.

## Implementation checklist - 3/5 Implemented; 2/5 In progress; 0/5 Not started; 0/5 independently Verified

1. **SC-0403-01 - Webhook store and processing.** **Acceptance:** Signature verified; duplicates ignored; events processed by re-fetching. **Required verification:** Integration tests with Stripe test mode. **Implementation:** In progress; signed endpoint, idempotent event store, current-state re-fetch, entitlement and quota updates are wired, and the maintenance leader drains Stripe retries every 60 s (`stripe_events` in `src/selecta/maintain.py`). Added on 2026-11-12: `tests/load/stripe_fixture_replay.py`, the tool for the staging run, replays events captured with `stripe listen --print-json` (or a folder of event JSON) at a webhook URL, freshly signed, in captured, reversed or seeded shuffled order with repeats, retrying 5xx and network errors with backoff, and reports statuses, outcomes, refusals and events already seen; it refuses live keys and non-staging hosts and prints the Stripe CLI capture commands. Its tests run it against the real route with a fake Stripe over a CLI-shaped capture (`tests/fixtures/stripe_cli_events.jsonl`): any order and repeats end at Stripe's current state, a second pass is all duplicates, a forged secret stores nothing, and events received during an outage are caught up by `drain_stripe_events`. Needs staging: the integration run against Stripe test mode (a Stripe test account and the staging webhook secret: capture with the CLI, then run the replay tool against staging). **Evidence:** `tests/test_cloud_stripe_fixture_replay.py` (passed on 2026-11-12); `tests/test_cloud_billing_api.py`; `tests/test_cloud_billing_webhooks.py`; `tests/test_cloud_maintenance_service.py`. **Independently Verified:** No.
2. **SC-0403-02 - Scrambled-event replay.** **Acceptance:** Hundreds of thousands of shuffled, duplicated and delayed events produce the correct final entitlements. **Required verification:** Replay test. **Implementation:** Implemented; a seeded bulk replay delivers every event of thousands of long subscription histories 1-3 times, shuffled and up to a day late, through timed Stripe outages and one-off 503s, then drains retries; every workspace ends at the snapshot its final Stripe state implies and no event is left unprocessed. **Evidence:** `tests/test_cloud_billing_replay.py` (10,000 deliveries by default, passing locally on 2026-11-10; 250,022 deliveries over 3,455 workspaces passed locally in 1,269 s with SELECTA_BILLING_REPLAY_DELIVERIES=250000, which the weekly job in `.github/workflows/nightly.yml` sets). **Independently Verified:** No.
3. **SC-0403-03 - Nightly reconciliation.** **Acceptance:** Drift is detected and corrected with an audit entry. **Required verification:** Integration test. **Implementation:** Implemented; reconciliation finds entitlement, version, expiry and unknown-price drift, fixes it with an audit entry and storage limit sync, and a second run finds nothing. **Evidence:** `tests/test_cloud_billing_maintenance.py`; green in CI run 42752343336 (Python shards on SQLite, Cloud / PostgreSQL). **Independently Verified:** No.
4. **SC-0403-04 - UK checkout consent.** **Acceptance:** Consent text is captured and stored with the subscription. **Required verification:** Playwright test. **Implementation:** Implemented; checkout needs all three consents and sends the consent version, which is stored with the subscription. **Evidence:** `web/e2e-cloud/billing.cloud.ts` 'checkout needs all three consents, sends the consent version, and waits for the snapshot', passing in `pnpm e2e:cloud`. **Independently Verified:** No.
5. **SC-0403-05 - Tax setup.** **Acceptance:** Stripe Tax configured for UK; EU sales blocked until OSS or merchant of record is decided. **Required verification:** Configuration review. **Implementation:** In progress; Checkout enables automatic tax, requires a billing address, updates the Stripe customer address and permits tax-ID collection. Needs a person: the operator's Stripe Tax UK registration and product tax codes in the Stripe dashboard, and an owner decision on how EU sales are blocked until OSS or a merchant of record is chosen (Stripe Checkout can't restrict billing countries, so it needs a Radar rule or a server check), then the configuration review. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
