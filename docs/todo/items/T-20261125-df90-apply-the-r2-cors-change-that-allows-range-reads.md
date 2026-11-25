---
id: T-20261125-df90
title: Apply the R2 CORS change that allows Range reads
area: infra
status: done
priority: high
who: owner
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit: 9a1968fa
---

infra/cloudflare/main.tf now allows the 'range' request header on the R2 buckets, which the hosted player uses to read its lossless files a few seconds at a time. Run tofu apply for staging (and production when it ships). Until then the player falls back to whole-body reads, which work but download far more for every window.

2026-11-25: Not needed for playback: R2 on staging answered the player's Range reads with 206 with no CORS change. Keep the rule change in infra for the next apply, but nothing waits on it.
