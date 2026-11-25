---
id: T-20261125-a895
title: The date Lucy gives for turns coming back is worked out in UTC, not the account's time zone
area: lucy
status: dropped
priority: normal
who: claude
created: 2026-11-25
source: ADR-0480 fault 3; ADR-0483 rule 4
commit:
---

_resets_words in src/selecta/lucy/cloud_agent.py calls month_resets_at(job.plan.month, 'UTC'). Allowances reset at local midnight in the account's zone, so near a month end the date can be a day out for anyone not on UTC. Good: use the account's time zone, the same value the meter shows.

2026-11-25: Not a fault. The month Lucy is given is already the account's own month, so the date she says (the 1st of the next month) is right in every time zone; checked for Auckland, Los Angeles and UTC at a month end. The UTC argument in _resets_words only formats that date.
