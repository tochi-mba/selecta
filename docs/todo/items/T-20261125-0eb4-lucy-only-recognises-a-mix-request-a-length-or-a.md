---
id: T-20261125-0eb4
title: Lucy only recognises a mix request, a length or a quick question in English
area: lucy
status: open
priority: later
who: either
created: 2026-11-25
source: Found while fixing T-20261125-9068; src/selecta/lucy/cloud_agent.py request_class
commit:
---

The words that decide which allowance a turn counts against are English patterns ('make a mix', '2 hours', 'what'). A request in another language counts as an everyday turn whatever it asks. Nobody is refused by this, since a used-up allowance steps down to the next, but the split between everyday, planning, deep plan and quick is only right in English. Good: either the model's own first step names the kind of turn, or the allowance stops depending on the kind (ADR-0481).
