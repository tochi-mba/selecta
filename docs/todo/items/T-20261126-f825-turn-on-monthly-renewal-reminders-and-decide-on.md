---
id: T-20261126-f825
title: Turn on monthly renewal reminders, and decide on a pause option, in Stripe
area: billing
status: open
priority: high
who: owner
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

docs/saas/08-billing.md has Stripe's upcoming-renewal reminders on for yearly prices only. The UK subscription rules under the DMCC Act (reported to start in January 2027, details still pending) add reminder notices and an easy online exit. Recurly reports that most people who pause instead of cancelling come back. Owner steps: in the Stripe dashboard, turn renewal reminders on for monthly prices as well, and check whether the customer portal can offer a pause; if it cannot, tell Claude and a pause becomes a small feature of our own.
