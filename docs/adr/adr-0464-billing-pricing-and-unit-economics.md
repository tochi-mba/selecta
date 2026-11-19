# ADR-0464 - Billing, pricing and unit economics in a no-audio Cloud

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 4/7 Implemented; 2/7 In progress; 1/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF5 (business). **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0402 (plans and entitlements, versioning) and ADR-0403 (Stripe): unchanged, used as-is. ADR-0441 (Business pricing): unchanged; BZ keeps its own pricing programme. Sibling BF ADRs: ADR-0456 (hosted grant), ADR-0465 (migration).
- **Source touchpoints:** `src/selecta/billing/plans.py` (new plan versions); `src/selecta/usage/meters.py`, `src/selecta/usage/quota.py` (hosted-only storage binding); `web/src/cloud/Billing.tsx`, `web/src/cloud/Meters.tsx`; [docs/saas/02-plans-and-economics.md](../saas/02-plans-and-economics.md) and [docs/saas/13-hosting-and-cost.md](../saas/13-hosting-and-cost.md) (updated by tasks below).
- **Proposal chapter:** [docs/saas/02-plans-and-economics.md](../saas/02-plans-and-economics.md), [docs/saas/08-billing.md](../saas/08-billing.md).

## Context and evidence boundary

The accepted plan catalogue (Free, Standard, Premium v1) prices hosted scarcity: storage bytes, daily analysis caps, speculative CPU minutes, export counts and upload sizes, with a pricing hypothesis of £6.99 and £12.99 a month (£59 and £109 a year). The cost model behind it (docs/saas/13) prices Render at $25 a month flat with $0.15/GB egress past 25 GB, R2 for media, Modal pools that scale to zero, and a break-even sketch: 8% of 2,000 members paying an average £9 is about £1,440 a month.

Local-first dissolves most of the cost side for default accounts. What remains per default account is metadata rows, SSE traffic and Lucy turns. What remains per hosted-flag account is today's full stack. External figures checked 2026-11-17 (sources at the end; re-check before implementation):

- **R2:** Standard storage $0.015 per GB-month, Infrequent Access $0.01 per GB-month, egress free, Class A operations $4.50 per million, Class B $0.36 per million. A full Standard quota (50 GB) therefore costs about $0.75 a month to hold; a full Premium quota (100 GB) about $1.50, plus roughly two thirds again for the Infrequent Access backup copy.
- **Consumer DJ software, 2026 prices:** djay Pro about $6.99 a month or $49.99 a year; Serato DJ Pro about $11.99 a month (lifetime $249 to $299); rekordbox tiers about $120, $180 and $360 a year; VirtualDJ Pro $19 a month or $299 outright, free for non-commercial use. Sources disagree on some figures and none were verified against vendor pages.
- **Business background music (context for BZ, not priced here):** Rockbot is listed around $25 per zone per month on comparison sites (one competitor page claims $16.95); Soundtrack Your Brand does not publish numeric prices on the page checked.

At the time of this decision nothing below was implemented; every number above is an input to be re-measured, not a decision output.

## Decision

- **Prices hold; value shifts.** The pricing hypothesis stays £0, £6.99 and £12.99 monthly (£59, £109 annual): Standard sits in the djay band and Premium in the Serato band of the 2026 consumer market, and SelectaDJ sells automatic mixing plus Rooms, not a performance deck, so the band is an anchor rather than a ceiling. What changes is what the tiers sell.
- **Paid axes in local-first mode:** Rooms (open rooms, guests, hours, request renders), Lucy allowance and model classes, playing devices and zones, scheduled discovery sweeps, and schedule/venue features as they land. Explicitly **not** paid axes for local-first accounts: storage, daily analysis caps, render or export counts, library caps tied to upload sizes. The owner's standing rule holds: no artificial quotas on local stem, analysis, render or export work, because the member's own device does that work.
- **Storage binds only where it costs.** `storage_bytes`, upload sizes and export retention keep their meaning only for accounts holding `cloud.hosted_media`; meters show the truthful "no hosted storage" state otherwise (BF-0456-06). Hosted remains a grant, never a plan line (ADR-0456), so no plan version mentions it.
- **Lucy ceilings keep the 40% rule.** Allowances stay sized so a member spending every turn costs at most about 40% of plan price in AI, with per-turn token and dollar ceilings as accepted in docs/saas/02 and 09; beta measurement replaces the estimates, and allowances are the lever if margins drift.
- **New plan versions, old ones honoured.** Free, Standard and Premium get v2 entries expressing the local-first axes through ADR-0402 versioning; existing subscribers keep v1 semantics until a notified change at renewal, exactly as the versioning contract already requires. Stripe products and tax handling are untouched (ADR-0403).
- **Unit economics become a dashboard, not a sketch.** Per-account-mode marginal cost (default versus hosted) is measured and watched: default accounts should land near zero marginal cost outside Lucy; hosted accounts carry storage at the R2 rates above. The break-even sketch updates from "costs scale with every member's media" to "costs scale with Lucy use and the grandfathered hosted population", which only shrinks.

## User outcome and acceptance contract

A member pays for what is scarce and valuable - Lucy's intelligence, Rooms, more devices and bigger discovery - and never for permission to analyse or export music their own computer is processing. Nobody's price rises because of this programme; existing subscribers see their plan version honoured; a grandfathered hosted member keeps the storage they pay for today at the same price.

## Edge cases

- **A v1 subscriber on a local-first default.** Their v1 entitlements (analysis caps and the rest) stop binding anything their device does locally; the account page explains why the old caps no longer appear; billing is unchanged until renewal offers v2.
- **A hosted-flag member downgrades plans.** Storage over the lower quota follows the existing over-quota read-only path; the grant itself is unaffected by plan moves.
- **Annual subscribers mid-cycle at cutover.** No forced change: v1 runs to term; the renewal notice carries the v2 comparison.
- **Lucy overspend attempts.** Per-turn ceilings and monthly allowances already hard-stop; nothing in local-first changes the AI cost controls.
- **A member with zero Cloud value** (no Lucy, no Rooms, one device): Free covers them indefinitely by design; the conversion story is Lucy and Rooms, not nagging.
- **Currency and tax.** GBP prices, Stripe tax handling and consent versioning stay exactly as ADR-0403 ships them; USD and EUR remain future owner decisions.

## Rejected alternatives

- **Cutting prices because costs fell.** The price was set against member value and the competitor band, not cost-plus; falling costs widen margin and fund the device-lab and Lucy allowances instead.
- **Metering local compute** (per-analysis or per-export charges): unenforceable against a member's own device, hostile, and against the owner's standing rule.
- **Selling hosted mode.** Rejected by the owner (ADR-0456); revisit only by a new ADR.
- **Storage-tiered plans without storage.** Keeping `storage_bytes` as the headline differentiator when default accounts store nothing would make the pricing page a lie; the axes above are what the tiers actually deliver.

## Implementation checklist - 4/7 Implemented; 2/7 In progress; 1/7 Not started; 0/7 independently Verified

1. **BF-0464-01 - Plan catalogue v2.** **Acceptance:** Free, Standard and Premium v2 entries in `src/selecta/billing/plans.py` express the local-first axes (Rooms, Lucy, devices, discovery), drop local-work quotas, and pass `validate_catalogue()`; a snapshot test proves v1 untouched. **Required verification:** Unit tests, catalogue validation. **Implementation:** Implemented in code: v2 Free, Standard and Premium preserve v1 entries and use the local-first plan axes in `src/selecta/billing/plans.py`. `tests/test_bf_plans_v2.py` covers v1 preservation, catalogue validation and the gated set; rerun after the code pass. **Independently Verified:** No.
2. **BF-0464-02 - Hosted-only storage binding.** **Acceptance:** Quota reservation, meters and over-quota states consult the hosted grant; default accounts never see a storage meter or an upload cap; hosted accounts see today's behaviour unchanged. **Required verification:** `tests/test_cloud_usage_quota.py`, `test_cloud_account_meters.py`, vitest on Meters. **Implementation:** Code is landed in `src/selecta/hosted_coexistence/grant.py`, `src/selecta/usage/meters.py` and `web/src/cloud/Meters.tsx`. Storage limits bind only for granted accounts or accounts with retained/reserved hosted bytes; the storage meter is hidden when neither exists. The Analysis and Exports caps now also require `cloud.hosted_media`, even when retained bytes keep `storage_mode="hosted"`. Existing quota and meter coverage needs extension for grant-off with retained bytes, then rerun after the code pass. **Independently Verified:** No.
3. **BF-0464-03 - Pricing page truth.** **Acceptance:** The plans page sells the v2 axes with no storage headline for default accounts, keeps `when_locked` teasers, and shows the same prices; copy says SelectaDJ. **Required verification:** Playwright pricing spec, copy audit. **Implementation:** Implemented in code: the plans page sells Rooms, Lucy, devices and discovery at the held prices without a default-account storage headline. `web/src/cloud/Billing.test.tsx` covers the page; the Playwright pricing spec and copy review still need to run. **Independently Verified:** No.
4. **BF-0464-04 - Lucy ceiling re-measurement.** **Acceptance:** Beta measurements of real turn costs per model class replace the estimates; allowances re-confirmed or adjusted under the 40% rule; the measurement method is recorded. **Required verification:** Metering data reviewed against invoices. **Implementation:** In progress: the measurement code exists in `src/selecta/usage/lucy_ceiling.py` with the admin report route in `src/selecta/admin/routes_economics.py`. No beta cost data has been reviewed against provider invoices, and the allowances have not been re-confirmed or adjusted. Needs real beta usage and human review. **Independently Verified:** No.
5. **BF-0464-05 - Per-mode cost dashboard.** **Acceptance:** Marginal cost per account mode (default versus hosted) is computed from real meters (R2 bytes and operations, egress, Lucy dollars) and visible to the owner; the docs/saas/13 sketch is updated from it. **Required verification:** Dashboard numbers reconciled against provider invoices for one month. **Implementation:** In progress: `src/selecta/usage/unit_economics.py`, `src/selecta/usage/observability.py`, `GET /api/admin/economics/cost-per-mode` and `tools/bf_unit_economics.py` provide per-mode reporting. Server-observed reads/writes/render usage and signed-URL authorizations are separated in the report; authorizations are not claimed as completed transfers, and cost fields with incomplete measurements are `null`/unknown rather than zero. Actual signed-URL transfer completion, full object-store Class A/B operations, direct object egress, Render response/SSE bytes and CPU, worker CPU duration, and provider invoice reconciliation remain unknown or pending. The dashboard is therefore only a partial software implementation; real per-mode data and invoice review remain outstanding. **Independently Verified:** No.
6. **BF-0464-06 - Economics chapters updated.** **Acceptance:** docs/saas/02 and 13 updated to the local-first cost structure with the researched rates and the shrinking-hosted-population model; stale hosted assumptions marked hosted-only rather than deleted. **Required verification:** Doc review. **Implementation:** Implemented in code and docs: `docs/saas/02-plans-and-economics.md` and `docs/saas/13-hosting-and-cost.md` reflect local-first costs and retain hosted-only assumptions. Doc review remains pending. **Independently Verified:** No.
7. **BF-0464-07 - Owner pricing confirmation.** **Acceptance:** The owner reviews the v2 axes, the held prices and the annual terms against the beta cost measurements and records the go-forward pricing decision. **Required verification:** Owner's recorded decision. **Implementation:** Not started. Needs a person: the owner must review the v2 axes and held prices after the beta cost measurements; no pricing decision is recorded. **Independently Verified:** No.

## Research sources (checked 2026-11-17; re-verify before implementation)

- R2 rates: [Cloudflare R2 pricing docs mirror](https://developers.cloudflare.com/r2/pricing/index.md), [Upstash R2 pricing guide 2026](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills), [Filebase R2 pricing 2026](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/).
- DJ software prices: [dj.studio 2026 price guide](https://dj.studio/blog/professional-dj-software-price-guide), [dj.studio subscriptions compared](https://dj.studio/blog/dj-software-subscriptions-buyers-guide), [clubdjsoftware.com cost roundup](https://www.clubdjsoftware.com/blog/how-much-does-dj-software-cost), [lexicondj.com best DJ software](https://www.lexicondj.com/blog/best-dj-software).
- Business background music: [G2 Rockbot pricing](https://www.g2.com/compare/rockbot-vs-soundtrack-your-brand), [Capterra Rockbot](https://www.capterra.com/p/255670/Rockbot/), [Cloud Cover comparison page](https://cloudcovermusic.com/lp/rockbot-vs-pandora-cloudcover) (competitor characterisation).

## Governance

Accepted by the owner on 2026-11-17 with prices held. Any actual price change, currency addition or hosted-mode sale is a separate owner decision through a new ADR; BF-0464-07 is confirmation of this one, not authority for those.
