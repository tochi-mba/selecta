---
id: T-20261125-14a6
title: Two sessions adding database migrations to main can leave two heads
area: ci
status: open
priority: normal
who: claude
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

It happened on 2026-11-25: main gained two room migrations while the engine store added one, and the chain had to be re-pointed by hand. Good: CI fails when either Alembic chain (shared, and engine_store/library_migrations) has more than one head.
