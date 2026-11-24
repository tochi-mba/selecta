---
id: T-20261124-7d84
title: Move the report-only Content-Security-Policy to enforced after a week without reports
area: security
status: open
priority: high
who: owner
created: 2026-11-24
source: docs/engineering/product-audit.md gap 7
commit:
---

web/public/_headers sends the full policy as Content-Security-Policy-Report-Only. After a week of real use with no reports for our own pages, move that line into the enforced Content-Security-Policy (and optionally add a report endpoint). Good: the policy blocks, and nothing on our pages breaks.
