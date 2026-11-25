---
id: T-20261125-9068
title: Lucy's request classifier only returns everyday or planning, so deep plan and quick allowances never apply
area: lucy
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0480 fault 2; LM-0480-03, LM-0481-04
commit:
---

request_class in src/selecta/lucy/cloud_agent.py returns PLANNING or EVERYDAY only. Premium's 25 deep plans are never drawn on, Premium planning turns use the everyday bucket, and quick fair use (1,000) becomes more Opus turns once everyday runs out, held only by the dollar ceiling. Good until ADR-0481 lands: either the classifier yields all four classes, or the plan tables and plan cards stop promising classes that cannot occur.
