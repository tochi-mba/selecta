---
id: T-20261126-483a
title: Set SELECTA_ALERT_EMAIL on the maintenance service
area: infra
status: open
priority: high
who: owner
created: 2026-11-26
source: hosted gaps, walkthrough section 11
commit:
---

Operator alerts (stuck queue, worker gateway down, autoscaler failing, a pool's spend ceiling) are mailed to this one address by notify/operator_alerts.py, once an hour per condition and once when it clears. Choose the address (default: the support mailbox you read most), set it with the SELECTA_EMAIL_* settings and SELECTA_WORKER_GATEWAY_URL on staging and production maintenance services. Until then nothing is sent and the console's setup checklist shows the item open.
