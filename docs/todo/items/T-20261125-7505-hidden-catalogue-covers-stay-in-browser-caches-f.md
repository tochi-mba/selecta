---
id: T-20261125-7505
title: Hidden catalogue covers stay in browser caches for up to a week
area: legal
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25 (ADR-0478 catalogue)
commit:
---

GET /api/catalog/art/{id}/{size} answers with Cache-Control private, max-age 604800, immutable. Hiding stops us serving it at once, but a browser that already has it keeps it. Good: a shorter max-age or a versioned URL that changes when hidden, decided with the takedown policy.
