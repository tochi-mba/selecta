---
id: T-20261125-29a0
title: Platform alerts reach nobody outside the console
area: infra
status: open
priority: high
who: claude
created: 2026-11-25
source: hosted edge-case check, T-20261125-803e case 19
commit:
---

What is wrong: every operator alert is a platform_alerts row (admin/alerts.py says a notifier reads the table), and no notifier exists: work.queue_stuck (no worker for 15 minutes), a kill switch, a repeat infringer and the security alerts show only on the console. notify/ sends customer mail only. A gateway that is down raises nothing at all (it is the gateway that would write the row). What good looks like: a maintenance task that mails each new alert to an operator address (SELECTA_ALERT_EMAIL) through the existing mail sender, at most one mail per kind per hour, plus an outside uptime check of the gateway's /api/ready and the API (the launch checklist's status page, T-20261124-608c). The owner sets the address and the uptime service; the code is claude's.
