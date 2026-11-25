---
id: T-20261125-89f0
title: Lucy's turns meter reads counters the gateway never writes, so it likely always shows nothing used
area: lucy
status: done
priority: high
who: claude
created: 2026-11-25
source: ADR-0477 fault 1; LM-0477-03, LM-0481-01
commit: a45a3153
---

The gateway counts turns in ai_usage (src/selecta/ai/allowance.py). The meters read lucy_turn.* allowance counters through src/selecta/usage/meters.py, and a search of src/ on 2026-11-25 found nothing that writes them outside tests and the /test/usage endpoint. Found by reading the code, not by watching staging: confirm on staging first by sending turns and reading Lucy's settings. Good: the meter shows what the gateway enforces, read from one place (ai.allowance.remaining() already reads the right table and is never called). ADR-0481 is the full fix; a short fix is to point the meter at ai_usage now.

2026-11-25: Fixed in code and proved by tests through the real admission path and in two browser tests; not yet watched on staging.
