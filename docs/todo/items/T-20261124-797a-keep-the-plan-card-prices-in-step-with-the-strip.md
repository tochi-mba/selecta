---
id: T-20261124-797a
title: Keep the plan card prices in step with the Stripe prices
area: billing
status: open
priority: normal
who: owner
created: 2026-11-24
source: docs/engineering/product-audit.md area D
commit:
---

Billing.tsx shows fixed price strings (6.99 and 59, 12.99 and 109 pounds). If a Stripe price changes, these must change in the same release.
