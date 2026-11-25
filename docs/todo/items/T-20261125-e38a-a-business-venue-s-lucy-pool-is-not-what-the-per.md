---
id: T-20261125-e38a
title: A business venue's Lucy pool is not what the personal turns meter shows
area: lucy
status: open
priority: normal
who: claude
created: 2026-11-25
source: Found while fixing T-20261125-89f0; ADR-0448
commit:
---

A business organisation's turns count against its venues' pool (business.entitlement_gates.lucy_start), not ai_usage, so Lucy's settings and Plan and billing show the personal plan's lines with nothing used. Good: for a workspace the pool covers, the meter shows the pool's lines and reset (entitlements.lucy_pools already has them), or the personal meter is hidden there.
