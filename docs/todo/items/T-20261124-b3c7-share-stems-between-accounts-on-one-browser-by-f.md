---
id: T-20261124-b3c7
title: Share stems between accounts on one browser by fingerprint
area: library
status: open
priority: later
who: claude
created: 2026-11-24
source: ADR-0469 amendment 1
commit:
---

Stem windows already have content keys under cloud.content_cache, but the player plans them without a content hash, so they stay per workspace. Pass a proven hash into the stem prefetcher, and never write a shared stem from a hosted copy this device has not hashed.
