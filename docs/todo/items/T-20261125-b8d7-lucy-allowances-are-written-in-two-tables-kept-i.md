---
id: T-20261125-b8d7
title: Lucy allowances are written in two tables kept in step by hand
area: lucy
status: open
priority: normal
who: claude
created: 2026-11-25
source: ADR-0477 fault 4; ADR-0482; LM-0482-01
commit:
---

src/selecta/billing/plans.py (catalogue v1 and v2) and src/selecta/ai/allowance.py both list the per-plan Lucy allowances, and src/selecta/ai/spend.py holds the dollar ceilings separately. Good: one catalogue entry that the gateway reads, or at least a test that fails when the two tables disagree.
