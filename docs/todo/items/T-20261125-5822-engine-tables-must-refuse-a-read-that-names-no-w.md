---
id: T-20261125-5822
title: Engine tables must refuse a read that names no workspace
area: security
status: open
priority: high
who: claude
created: 2026-11-25
source: ADR-0477 and the owner's plan approval, 2026-11-25
commit:
---

The row-level policy (migration b7e3c91f0a24) lets a transaction with no workspace read every tenant, which is right for maintenance and wrong for engine data. Good looks like: engine tables use a fail-closed policy, the engine store refuses to open without a workspace, and a test shows an unscoped read returns nothing on Postgres. ADR-0477 phase 3.
