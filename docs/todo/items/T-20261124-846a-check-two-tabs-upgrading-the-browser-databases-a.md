---
id: T-20261124-846a
title: Check two tabs upgrading the browser databases at once, in a real browser
area: library
status: open
priority: normal
who: claude
created: 2026-11-24
source: docs/engineering/product-audit.md area F
commit:
---

Three stores now let go on versionchange (dd30659b). Good: after a deploy, two open tabs both carry on without losing the library or the outbox.
