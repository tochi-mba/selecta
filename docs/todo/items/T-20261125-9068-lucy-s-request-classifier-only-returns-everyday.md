---
id: T-20261125-9068
title: Lucy's request classifier only returns everyday or planning, so deep plan and quick allowances never apply
area: lucy
status: done
priority: high
who: claude
created: 2026-11-25
source: ADR-0477 fault 2; LM-0477-03, LM-0478-04
commit: a45a3153
---

request_class in src/selecta/lucy/cloud_agent.py returns PLANNING or EVERYDAY only. Premium's 25 deep plans are never drawn on, Premium planning turns use the everyday bucket, and quick fair use (1,000) becomes more Opus turns once everyday runs out, held only by the dollar ceiling. Good until ADR-0478 lands: either the classifier yields all four classes, or the plan tables and plan cards stop promising classes that cannot occur.
