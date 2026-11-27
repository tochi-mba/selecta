---
id: T-20261126-012b
title: Put the VAT-inclusive price on the landing page
area: branding
status: blocked
priority: high
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

Welcome.tsx shows no price by design. NN/g found that hiding prices makes people hostile, and UK drip-pricing rules (DMCC Act, in force since April 2025) want headline prices to include VAT. Good looks like: a short plans strip on the landing page with Free, Standard and Premium, VAT-inclusive, the yearly total beside the monthly price, and a small per-day figure beside, never instead of, the monthly price (about 23p a day for Standard). Blocked until the owner confirms the Stripe prices include VAT (T-20261124-8c73).
