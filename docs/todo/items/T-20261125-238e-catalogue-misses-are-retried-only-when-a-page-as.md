---
id: T-20261125-238e
title: Catalogue misses are retried only when a page asks again
area: library
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25 (ADR-0478 catalogue)
commit:
---

catalog_lookups.next_retry_at is honoured, but nothing sweeps due retries; a lookup is queued again only when POST /api/catalog/art is called. Good: a periodic sweep, or a clear decision that on-view is enough.
