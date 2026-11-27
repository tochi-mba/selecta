---
id: T-20261126-6a1b
title: Before checkout, say plainly how cancelling and refunds work
area: billing
status: open
priority: high
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

Lenient, clearly stated return policies raise purchases more than they raise returns (Janakiraman et al. 2016 meta-analysis). Plan & billing (web/src/cloud/Billing.tsx) says 'you can change or cancel at any time' but not how, and says nothing about refunds. Good looks like: one short line by the Continue button, 'Cancel in two clicks from Plan & billing', plus the refund terms once the refund policy exists (legal pages item T-20261124-c389). No guilt-trip wording anywhere in the cancel path, and a library is never held hostage on downgrade.
