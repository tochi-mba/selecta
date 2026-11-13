# ADR-0447 - Business billing: Stripe quantity subscriptions, invoices, B2B VAT, dunning without silence

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/15 Not started.
- **Independent verification:** 0/15 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build and test in Stripe test mode, selling off); live billing only in Phase B2. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0403 (Stripe billing and UK VAT), ADR-0402, ADR-0441, ADR-0442 (organisations and venues), ADR-0444 (opening hours); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/billing/`; new `src/selecta/business/billing.py`; `src/selecta/flags/cloud.json` (new `business.billing`); new `web/src/business/billing/`.
- **Proposal chapter:** [docs/saas/19-business-venues.md](../saas/19-business-venues.md#197-billing-design-and-edge-cases).

## Context and evidence boundary

ADR-0403 bills one person per workspace. A business pays for many venues, zones and staff seats, wants VAT-correct invoices with purchase-order numbers, and cannot accept music stopping mid-service because a card failed. Stripe models this as one subscription with several items, each with a quantity; changing a quantity can create prorations. UK B2B sales carry no consumer 14-day cancellation right, and services to EU businesses with a valid VAT number are normally zero-rated by the UK supplier with the customer reverse-charging the VAT.

This ADR records a proposed decision. Nothing in it is implemented; Stripe behaviour cited from public docs must be re-checked in test mode.

## Decision

- **One subscription per organisation** with quantity items: `business_venue` (quantity = active paid venues), `business_extra_zone` (quantity = zones above one per venue), `business_extra_seat` (seats above three per venue). Quantities are computed by the server from ADR-0442 data, never typed by a client. The ADR-0403 rule holds: every webhook is a poke, re-fetch and recompute.
- **Adding** a venue, zone or seat takes effect at once and is charged prorated (`proration_behavior=create_prorations`, collected on the next invoice; or immediately for amounts above a threshold the owner sets). **Removing** takes effect at period end with no credit by default, and the item keeps working until then.
- **Trial:** 14 days, 1 venue and 1 zone, card required; one trial per organisation and per card fingerprint.
- **B2B checkout:** the buyer confirms they act for a business; business terms (ADR-0449) are accepted and versioned; company name, billing address and tax ID are collected; the consumer cancellation flow of ADR-0403 does not apply.
- **VAT:** UK customers pay UK VAT. EU business customers with a VAT number that validates at the time of sale get a zero-rated invoice with a reverse-charge note; the validation result is stored. Without a valid number, EU sales stay blocked as in ADR-0403. Tax IDs are re-checked before each renewal.
- **Invoices:** one consolidated invoice per organisation with venue names in line descriptions and a per-venue cost breakdown; up to four custom fields (PO number at organisation level, optional per-venue cost centre). Invoice payment by bank transfer (`send_invoice`, net 30) is offered for annual plans and Enterprise.
- **Dunning without silence:** 14-day grace on a failed payment; emails to owner and admins on days 0, 3, 7 and 12; an in-app banner on manager and admin devices only, never on the customer-facing display; after grace, management becomes read-only; playback stops only at each venue's next closing time after grace, with 72 h and 24 h warnings.
- **Downgrade:** the owner picks which venues stay; unpicked venues and zones over the paid count pause at their next closing time; nothing is deleted and resuming restores them.
- **Venue changing organisation:** both organisation owners consent; the venue moves at the next billing period boundary; library rights do not move automatically.
- **Disputes:** never silence a venue automatically; a lost dispute enters the same grace path as a failed payment.
- **Enterprise:** contracts outside Stripe are stored as audited contract entitlements with term, venues, price and expiry; reconciliation leaves them alone.

## User outcome and acceptance contract

A business sees one predictable bill per month, can add a venue in a minute and see exactly what it will cost, gets invoices its accountant accepts, and never has music cut mid-service by a billing problem without days of warning.

## Edge cases

- Adding three venues in one minute: one quantity update per change, idempotent; the preview always shows the final total.
- Removing a venue then re-adding it in the same period: no second charge for the same period.
- A webhook says the subscription is `past_due` while a venue is mid-service: nothing stops; the grace clock starts.
- Grace ends at 15:00 while a venue is open until 02:00 the next day (overnight hours): it stops at 02:00, after the 72 h and 24 h warnings have been sent; a venue already past its last warning never stops earlier than its close.
- Opening hours missing or the venue set to 24 hours: stop at the first daily quiet point the owner chose, else 04:00 local, with warnings.
- The venue's internet is down at the stop time: the kiosk stops at its own known close time from its cached schedule (ADR-0446).
- VAT number fails validation at renewal: the renewal is held, the owner is told, and the grace path applies, never a silent VAT change.
- A PO number expires mid-year: the admin edits it; it applies to draft and future invoices only (finalised invoices cannot change).
- Venue transfer between organisations with different currencies: the receiving organisation's currency applies from the next period.
- Refund asked after a missed SLO: credit note against the next invoice per the service-credit policy (ADR-0448), not a card refund by default.
- A chargeback on an annual payment: billing staff review; the venue keeps playing during the dispute.
- Enterprise contract expiry with no renewal: 30, 14 and 3 day warnings to the owner and REX Technologies sales, then the grace path.

## Rejected alternatives

- One Stripe subscription per venue (many invoices, harder volume discounts, more failure points).
- Stopping playback immediately on failure (a silent venue is the worst failure and loses the customer).
- Crediting removed venues mid-period (encourages churn games and complicates invoices).

## Implementation checklist - 0/15 Not started; 0/15 independently Verified

1. **BZ-0447-01 - Business prices and catalogue map.** **Acceptance:** Stripe products and prices for venue, extra zone and extra seat, monthly and annual, per currency, created by a test-mode setup script and mapped server-side to `business_venue_v1`; flag `business.billing` registered (default off). **Required verification:** Unit tests with a fake Stripe. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0447-02 - Quantity subscription and reconciliation.** **Acceptance:** One subscription per organisation; quantities computed from venues, zones and seats; reconciliation finds and fixes quantity drift with an audit entry, and a second run finds nothing. **Required verification:** Integration tests with a fake Stripe. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0447-03 - Add and remove mid-period with proration.** **Acceptance:** Adding a venue, zone or seat is immediate and prorated, with a cost preview from Stripe's upcoming invoice before confirming; removing takes effect at period end; remove then re-add in one period never double-charges. **Required verification:** Integration tests with a fake Stripe and a time-travel clock. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0447-04 - Trial.** **Acceptance:** 14-day trial with 1 venue and 1 zone and a card; one trial per organisation and per card fingerprint; conversion or lapse behaves as specified. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0447-05 - Volume discount and Enterprise threshold.** **Acceptance:** 10 to 24 venues bill at 10% off; 25 or more cannot check out self-serve and are routed to a sales form. **Required verification:** Unit and integration tests. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0447-06 - B2B checkout.** **Acceptance:** Checkout captures the business confirmation, business terms version, company name, billing address and tax ID; the consumer cancellation acknowledgement is not shown for business plans. **Required verification:** Playwright test against a fake Stripe. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0447-07 - B2B VAT and reverse charge.** **Acceptance:** UK customers are charged UK VAT; an EU business with a VAT number valid at the time of sale gets a zero-rated invoice with a reverse-charge note; the validation result and time are stored; tax IDs are re-checked before renewal; invalid numbers keep EU sales blocked. **Required verification:** Integration tests with a fake Stripe Tax and a fake VIES response. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0447-08 - Invoices with PO numbers and venue breakdown.** **Acceptance:** Organisation PO number and per-venue cost centre appear as invoice custom fields; line descriptions name venues; a per-venue cost breakdown CSV downloads from the billing page; bank-transfer invoices with net 30 are available for annual plans. **Required verification:** Integration tests plus a Playwright test for the download. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0447-09 - Dunning without silence.** **Acceptance:** A failed payment starts 14-day grace; emails go to owner and admins on days 0, 3, 7 and 12; the banner shows on manager devices only and never on the customer display; after grace, management is read-only; playback stops only at each venue's next closing time with 72 h and 24 h warnings, including overnight hours and missing hours. **Required verification:** Integration tests with a time-travel clock plus a Playwright test that the customer display never shows billing state. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0447-10 - Downgrade chooses venues.** **Acceptance:** Reducing venues asks the owner which stay; unpicked venues and zones over the paid count pause at their next close; nothing is deleted; resuming restores schedules, crates and devices. **Required verification:** Integration tests plus a Playwright test of the picker. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0447-11 - Venue transfer between organisations.** **Acceptance:** Both owners consent; the venue, its zones, devices, licence attestations and play logs move at the next period boundary; library tracks stay with the source organisation unless the receiving owner re-uploads or attests rights; both subscriptions' quantities update; every step is audited. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0447-12 - Refunds, disputes and chargebacks.** **Acceptance:** Refunds and service credits are staff actions with reasons; a dispute never stops a venue; a lost dispute enters the grace path; the written B2B refund policy is linked from the business terms. **Required verification:** Integration tests plus doc review. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0447-13 - Enterprise contracts outside Stripe.** **Acceptance:** Staff record a contract (term, venues, zones, seats, price, invoice terms, expiry) as an audited entitlement source that never pretends Stripe charged; reconciliation skips it; expiry warnings at 30, 14 and 3 days. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
14. **BZ-0447-14 - Billing pages.** **Acceptance:** Owner and admin billing pages show venues, zones, seats, next invoice, grace state and invoices; staff and venue managers never see billing; both themes and 320 px. **Required verification:** Playwright tests. **Implementation:** Not started. **Independently Verified:** No.
15. **BZ-0447-15 - Stripe test-mode staging run and accountant review.** **Acceptance:** Every flow above runs against Stripe test mode on staging with the replay tool; an accountant confirms invoice wording, reverse-charge notes and VAT handling. **Required verification:** Staging run report plus accountant sign-off. **Implementation:** Not started. Needs a person: a Stripe test account and staging run, and an accountant's review. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
