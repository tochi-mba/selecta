---
id: T-20261125-c01e
title: Lucy says 'used this month's turns' when the dollar ceiling was the cause
area: lucy
status: done
priority: normal
who: claude
created: 2026-11-25
source: ADR-0480 fault 3; ADR-0483 rule 3; LM-0483-03
commit: a45a3153
---

builtin_words in src/selecta/lucy/cloud_agent.py uses one sentence for limited == 'allowance' and limited == 'spend'. When the monthly dollar ceiling stopped the turn the person may still have turns on the meter, so the words are untrue. Good: separate, true words for each cause.
