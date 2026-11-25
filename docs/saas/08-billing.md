*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 8. Billing and entitlements (Stripe, UK business)

### 8.1 Stripe setup

- Products: SelectaDJ Standard, SelectaDJ Premium. Prices: monthly and annual in GBP (beta), USD and EUR later.
- **Stripe Checkout** for purchase, **Customer Portal** for upgrades, downgrades, payment methods, invoices and cancellation, **Stripe Tax** for VAT calculation, **Smart Retries** for failed renewals.
- A server-side plan catalogue maps Stripe price IDs → `plan_id` and version; the client never sends a plan name that is trusted.

#### Current API implementation

Cloud mode exposes `POST /api/billing/checkout`, `POST /api/billing/portal`, and
`POST /api/webhooks/stripe`. Checkout accepts a plan and interval, resolves those to a configured
server-side price, requires the current versioned consent plus explicit immediate-access and
cancellation-right acknowledgements, and only builds redirects from the configured CORS origin.
Both session routes require an `Idempotency-Key`; customer records are workspace-scoped. Portal
access has its own `billing.portal` kill switch so users can still manage or cancel subscriptions
when new checkout is disabled.

The webhook caps request bodies, verifies the raw-body Stripe signature (supporting secret
rotation), inserts each event once, ignores unknown event types, and re-fetches Stripe state before
updating entitlement snapshots and storage limits. A repeated delivery retries an event that is
still `received` or `failed`. `billing.maintenance` now provides a bounded retry drain and a full
subscription reconciliation with quota synchronization and append-only audit entries written in
the same transaction as each correction (including unmatched Stripe subscriptions). Run `uv run
selecta billing-maintenance` from a scheduled process to drain events and add `--reconcile` for the
full subscription sweep. Production scheduling and drift alerts remain outstanding.
Reconciliation records changes to entitlement versions, expiry, source and reason as well as
plan names, so a catalogue version change also updates the workspace quota and audit trail.
Webhook processing and maintenance use the effective entitlement when setting storage limits,
including active staff overrides. Full reconciliation also refreshes every existing quota account
so an expired override returns to the underlying plan even when Stripe has not changed.
Production PostgreSQL
and real Stripe test-mode runs remain to be verified.

`GET /api/account` carries what the Plan & billing page needs: `entitlement.plan_label` and
`snapshot_version`, `billing.consent_version` (the server's current checkout consent version, so
the form sends exactly the version the server will check), `lucy.tier`, and `usage` with four
meters read from the rows the server enforces with (`selecta.usage.meters`): storage used of the
limit (with committed, reserved, over-by and state), songs analysed today, exports this month
(with retention days and whether over-quota blocks them) and Lucy turns this month (per model
class and summed; a fair-use class has no limit). Each allowance carries its `resets_at`, the
account's own local midnight. Writing a new entitlement snapshot version emits an
`entitlement.changed` outbox event in the same transaction, so a page waiting on a checkout hears
the change over `/api/events`; re-confirming an unchanged snapshot emits nothing.

Checkout creation enables Stripe automatic tax, requires a billing address, updates the stored
Stripe customer address and permits tax-ID collection. Stripe's business address, registrations
and product tax codes must be configured before paid launch. The UK-only beta restriction must be
enforced with Stripe account-level controls; collecting an address in Checkout is not a country
restriction.

Configuration: `SELECTA_STRIPE_SECRET_KEY`, `SELECTA_STRIPE_WEBHOOK_SECRETS` (comma-separated
rotation set), `SELECTA_STRIPE_PRICES` (JSON price-id to plan/version/interval map),
`SELECTA_CHECKOUT_CONSENT_VERSION`, and optionally `SELECTA_IP_HASH_KEY` and
`SELECTA_STRIPE_API_VERSION`. Checkout requests Stripe automatic tax, a billing address, customer
address updates, and tax-ID collection. Before taking payments, configure the Stripe account's
business address, registrations and product tax codes, then enforce the UK-only beta sales boundary
in account-level controls.

#### Checkout consent wording register

The current staging and production configuration uses the immutable version
`uk-consumer-checkout-2026-11-20-v1`. It identifies the wording rendered by
`web/src/cloud/Billing.tsx` on 20 November 2026:

- "I agree to the subscription terms."
- "I ask for access to start immediately."
- "I understand my 14-day cancellation right and when I may lose it."

The explanatory paragraph says that UK law gives the customer 14 days to cancel a digital
subscription and that requesting immediate access may cause that right to be lost once the service
has been fully provided. Both `SELECTA_CHECKOUT_CONSENT_VERSION` and the public build value
`VITE_CHECKOUT_CONSENT_VERSION` must be exactly `uk-consumer-checkout-2026-11-20-v1` for this
wording. The identifier is an audit key, not editable copy: any change to the paragraph, checkbox
wording, linked subscription terms, or cancellation effect requires a new dated `v2` (or later)
identifier in both settings. Preserve the old wording/version association for existing consent
records. This records the implemented text; qualified UK consumer-law review remains a paid-launch
gate.

### 8.2 Event handling

- Webhook endpoint verifies the signature, stores the event id in `stripe_events` (unique), returns 200 fast, and a job processes it.
- Processing treats each event as a "poke": re-fetch the subscription from Stripe and recompute the entitlement snapshot. That makes duplicates and out-of-order delivery harmless.
- Events used: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`, `entitlements.active_entitlement_summary.updated` (optional).
- Nightly reconciliation lists all subscriptions and fixes drift; mismatches show on the admin Billing page.
- Returning from Checkout shows "Confirming your payment…" until the snapshot updates (usually seconds), never a premature "You're Premium".

### 8.3 Entitlement rules

| Situation | Behaviour |
|---|---|
| Upgrade | Immediate, prorated; queued jobs speed up at next dispatch |
| Downgrade | At period end (portal setting); over-quota read-only if needed |
| Cancel | Paid features until period end, then Free |
| Payment fails | `past_due`: keep paid entitlements for 7 days while Smart Retries run; email the user; then Free limits |
| Refund / dispute | Billing staff decide; automatic move to Free on dispute loss |
| Stripe outage | Keep last verified snapshot for up to 72 hours; new purchases wait |
| Manual override | Separate `entitlement_overrides` row with reason, expiry and actor; never pretends Stripe charged |

### 8.4 UK-specific obligations (confirm with an accountant and a lawyer)

- **VAT**: UK VAT registration is required once UK taxable turnover passes £90,000 (voluntary earlier). Selling digital services to **EU consumers** from the UK has **no EU threshold**: EU VAT is due from the first sale, typically via the non-Union One-Stop-Shop. US states tax SaaS variously with economic-nexus thresholds.
  - **Recommendation**: take payments from UK customers only during the private beta; before selling to the EU, either register for non-Union OSS (Stripe Tax calculates; you file) or switch to a merchant of record. Check whether Stripe Managed Payments (Stripe as merchant of record) is available to UK businesses by then; its surcharge is ~3.5% on top of normal fees.
- **Consumer cancellation rights**: UK consumers have a 14-day cancellation right for digital services unless they expressly ask for immediate access and acknowledge losing the right; capture that consent at checkout. Newer UK subscription-contract rules (DMCC Act 2024) add reminder and easy-exit duties as they commence; the Customer Portal plus renewal reminder emails covers the spirit now.
- **Invoices** with VAT details are produced by Stripe once VAT-registered.

---

[← 07a-authentication.md](07a-authentication.md) · [Contents](README.md#chapters) · [09-lucy-ai-gateway.md →](09-lucy-ai-gateway.md)

### 8.5 Telling the customer about billing moments (`billing.standing`)

The server works out one billing moment per workspace (`src/selecta/billing/standing.py`) and
sends it in `/api/account` as `billing.standing`. The app shell and Plan & billing show it as a
calm notice (`web/src/cloud/BillingStanding.tsx`), dated in the person's own time zone:

| Moment | Notice | Button |
|---|---|---|
| Renewal failed, 7 days of grace running | We couldn't take your last payment. Your {plan} stays until {date}. Update your card to keep it. | Update card (portal) |
| The bank wants a payment confirmed (3D Secure, `incomplete` or `invoice.payment_action_required`) | Your bank wants you to confirm your last payment. | Confirm payment (portal) |
| Cancelled, running to period end | Your {plan} plan ends on {date}. After that you're on Free. | Keep my plan (portal) |
| Dropped to Free because payment failed (shown for 30 days) | Your {plan} plan ended on {date} because payment failed. Your music and mixes are still here. | none |

Dismissing hides that one event in this browser for good; a new state or date shows again. A
member who cannot manage billing is told the workspace owner can update the payment details.

### 8.6 Which emails Stripe sends and which SelectaDJ sends

One email per event, never two. SelectaDJ's own are in `src/selecta/notify/billing_mail.py` and
go once each through the `emails` maintenance task.

| Event | Sent by | Stripe dashboard setting (Settings, Billing, Customer emails) |
|---|---|---|
| Receipt and invoice for every payment | Stripe | "Successful payments": on |
| Refund | Stripe | "Refunds": on |
| Confirm a payment (3D Secure) | Stripe, with its hosted link | "Send a Stripe-hosted link for customers to confirm their payments when required": on |
| Renewal failed | SelectaDJ (`billing_payment_failed`, with the grace date) | "Failed payments" (Manage failed payments, customer emails): **off** |
| Card about to expire | Stripe | "Expiring cards": on |
| Cancelled plan ends in 3 days | SelectaDJ (`billing_plan_ending`) | none in Stripe |
| Plan ended (payment failed or cancelled) | SelectaDJ (`billing_plan_ended`) | "Canceled subscriptions" email, if offered: **off** |
| Plan started or changed | SelectaDJ (`billing_plan_now`, no amounts) | none in Stripe; the receipt carries the amount and VAT |
| Upcoming renewal reminder (yearly) | Stripe | "Upcoming renewals": on for yearly prices |

The owner must set the two **off** switches before launch; until then a customer gets Stripe's
failed-payment email and ours for the same failure.

### 8.7 Extra Lucy usage in packs (ADR-0486, flag `lucy.extra_usage`)

The mechanism is built and is off for everyone. **Nothing can be bought** until the owner sets
both variables below, the refund, expiry and VAT wording has been reviewed (LM-0486-02), and a
staff rule grants the flag. No pack size or price is set in the code.

What is built (`src/selecta/billing/lucy_packs.py`, `lucy_packs_routes.py`):

- `SELECTA_STRIPE_PACK_PRICES`: JSON mapping a Stripe price id to `{"units": int, "label": str}`.
  Unset, empty or invalid means no pack is on sale. `SELECTA_PACK_CONSENT_VERSION` names the
  point-of-sale wording the buyer accepts; unset means unavailable.
- `GET /api/billing/lucy-packs`: the catalogue, whether a pack can be bought now and the reason
  if not (`packs_not_configured`, `paid_plan_required`, `pack_cap_reached`), this month's count
  against the cap, the balance, whether this week is confirmed, and the workspace's packs.
- `POST /api/billing/lucy-packs/checkout`: a Stripe Checkout Session in payment mode, card only,
  with metadata `workspace_id`, `kind=lucy_pack`, `price_id` and `consent_version`. It needs an
  `Idempotency-Key`, an allowlisted Origin and the right to manage billing. It writes no plan
  consent row, so it never holds the plan checkout as in progress.
- `POST /api/billing/lucy-packs/confirm`: the member's yes for the current week.
- The Stripe webhook credits the pack. A `checkout.session.completed` event for a paid
  payment-mode session of our kind adds one `lucy_usage_packs` row keyed by the payment intent
  id, with the catalogue's units for that price. Its customer must be the workspace's own. An
  unpaid session or a price outside the catalogue credits nothing and the event is stored as
  `ignored` with the reason.

The rules:

| Rule | Behaviour |
|---|---|
| Prepaid only | A pack is paid for before any unit exists. No billing in arrears, no automatic top-up |
| Paid plans only | A Free workspace is refused with `paid_plan_required` |
| One credit per payment | Replayed and duplicated events credit once |
| Monthly cap | `PACKS_PER_MONTH = 4` packs per workspace per calendar month (UTC), a starting hypothesis; a fifth is refused with `pack_cap_reached`. A refunded pack still counts |
| Expiry | Units last 365 days from purchase, then stop counting |
| Refund | An unspent pack is refundable for 14 days (`refundable`, `mark_refunded`). The staff route that returns the money is not built |
| Spending | `spend` takes from the pack that expires soonest and never below zero. It is not wired into the gateway yet (LM-0486-04) |
| Confirmation | One yes per week, stored as `extra_confirmed_week_seq` |

Still open: the consent a buyer gives is sent to Stripe as session metadata and is not stored
in our database; the cap counts credited packs, so sessions opened at the same time and all
paid can pass it; the catalogue carries no price to show, so the page must take it from the
label or from Stripe.
