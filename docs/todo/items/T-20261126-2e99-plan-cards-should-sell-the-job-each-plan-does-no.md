---
id: T-20261126-2e99
title: Plan cards should sell the job each plan does, not a list of allowances
area: billing
status: open
priority: high
who: claude
created: 2026-11-26
source: docs/research/worth-paying-for.md
commit:
---

web/src/cloud/Billing.tsx sells Standard as 'More from Lucy' and Premium as 'Rooms and Lucy Advanced', then lists allowances. The Devices line is the same on both paid plans, so it adds length without telling them apart. People buy what fits a job (Jobs to be Done; worth-paying-for.md section 3), and tiers split by features people cannot value underperform.

Good looks like: Standard as 'your own DJ, planning with you'; Premium as 'host the night: guests request, you stay in charge'. Lucy stays a level line (ADR-0485: no turns, no model names). Lines that are the same on every plan move to one shared 'every plan includes' line, which also says the transitions themselves are on every plan, Free included.
