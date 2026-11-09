# ADR-0403 - Stripe billing, reconciliation and UK VAT

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/5 Implemented; 0/5 In progress; 5/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 4. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0402; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/billing/`; `web/src/billing/`.
- **Proposal chapter:** [docs/saas/08-billing.md](../saas/08-billing.md#82-event-handling).

## Context and evidence boundary

Stripe collects payments; Selecta owns entitlements. Webhooks arrive late, twice or out of order, and the business is UK-based with VAT and consumer-law obligations.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

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

## Implementation checklist - 0/5 Implemented; 0/5 independently Verified

1. **SC-0403-01 - Webhook store and processing.** **Acceptance:** Signature verified; duplicates ignored; events processed by re-fetching. **Required verification:** Integration tests with Stripe test mode. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0403-02 - Scrambled-event replay.** **Acceptance:** Hundreds of thousands of shuffled, duplicated and delayed events produce the correct final entitlements. **Required verification:** Replay test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0403-03 - Nightly reconciliation.** **Acceptance:** Drift is detected and corrected with an audit entry. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0403-04 - UK checkout consent.** **Acceptance:** Consent text is captured and stored with the subscription. **Required verification:** Playwright test. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0403-05 - Tax setup.** **Acceptance:** Stripe Tax configured for UK; EU sales blocked until OSS or merchant of record is decided. **Required verification:** Configuration review. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
