*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 8. Billing and entitlements (Stripe, UK business)

### 8.1 Stripe setup

- Products: Selecta Standard, Selecta Premium. Prices: monthly and annual in GBP (beta), USD and EUR later.
- **Stripe Checkout** for purchase, **Customer Portal** for upgrades, downgrades, payment methods, invoices and cancellation, **Stripe Tax** for VAT calculation, **Smart Retries** for failed renewals.
- A server-side plan catalogue maps Stripe price IDs → `plan_id` and version; the client never sends a plan name that is trusted.

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

[← 07-identity-rbac-admin.md](07-identity-rbac-admin.md) · [Contents](README.md#chapters) · [09-lucy-ai-gateway.md →](09-lucy-ai-gateway.md)
