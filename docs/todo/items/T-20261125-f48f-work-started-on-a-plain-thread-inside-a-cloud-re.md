---
id: T-20261125-f48f
title: Work started on a plain thread inside a Cloud request reads the process flags
area: infra
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

flags.bound follows await and asyncio.to_thread but not threading.Thread. Any route that starts a thread (render and analysis helpers do on Desktop) would run with the build's flags, not the account's, once those routes are mounted in Cloud. Good: grep every threading.Thread reachable from a route and wrap its target in flags.carry, with a guard test.
