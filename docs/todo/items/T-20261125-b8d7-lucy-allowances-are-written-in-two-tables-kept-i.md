---
id: T-20261125-b8d7
title: Lucy allowances are written in two tables kept in step by hand
area: lucy
status: done
priority: normal
who: claude
created: 2026-11-25
source: ADR-0480 fault 4; ADR-0485; LM-0485-01
commit: a45a3153
---

src/selecta/billing/plans.py (catalogue v1 and v2) and src/selecta/ai/allowance.py both list the per-plan Lucy allowances, and src/selecta/ai/spend.py holds the dollar ceilings separately. Good: one catalogue entry that the gateway reads, or at least a test that fails when the two tables disagree.

2026-11-25: Guarded, not merged: test_every_plan_version_sells_exactly_what_the_gateway_enforces fails when the plan table and the gateway's allowances disagree. Making them one table is ADR-0485 (LM-0485-01).
