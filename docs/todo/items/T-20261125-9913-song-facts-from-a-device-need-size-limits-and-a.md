---
id: T-20261125-9913
title: Song facts from a device need size limits and a shape check before they are stored
area: security
status: open
priority: high
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

A device will send per-bar arrays for each song. Nothing yet bounds them: a ten hour file, a forged request with huge arrays, NaN or infinity, or millions of rows could fill the account's storage or break the planner. Good: a schema with maximum lengths, finite numbers only, a per-workspace count limit, and the facts counted in the data export and removed by account deletion.
