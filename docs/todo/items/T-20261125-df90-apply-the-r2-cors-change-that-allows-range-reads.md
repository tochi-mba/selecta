---
id: T-20261125-df90
title: Apply the R2 CORS change that allows Range reads
area: infra
status: open
priority: high
who: owner
created: 2026-11-25
source: hosted player rework, walkthrough section 8, 2026-11-25
commit:
---

infra/cloudflare/main.tf now allows the 'range' request header on the R2 buckets, which the hosted player uses to read its lossless files a few seconds at a time. Run tofu apply for staging (and production when it ships). Until then the player falls back to whole-body reads, which work but download far more for every window.
